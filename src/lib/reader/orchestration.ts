import "server-only";

import { openai } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import { z } from "zod";
import {
  finish as finishReaderSession,
  saveNotes as persistReaderNotes,
  type SaveNotesInput,
} from "@/lib/reader/checkpoint-tools";
import {
  inspectSlice,
  jumpToLine,
  readLines,
  skipLines,
} from "@/lib/reader/navigation-tools";
import { MAX_READ_LINES, readerSourceAdapter } from "@/lib/reader/source-adapter";
import {
  buildReaderFinishPrompt,
  buildReaderRunPrompt,
  buildReaderSynthesisPrompt,
  buildReaderSystemPrompt,
  READER_FINAL_CHECKPOINT_KIND,
  READER_SYNTHESIS_READY_SENTINEL,
} from "@/lib/reader/orchestration-prompt";
import {
  createReaderSession,
  getReaderSessionArtifacts,
  getReaderSession,
  saveReaderHandoff,
  updateReaderSession,
} from "@/lib/reader/persistence";
import {
  createReaderSessionEvent,
  type ReaderSessionEventSink,
} from "@/lib/reader/events";
import { runReaderReconnaissance } from "@/lib/reader/reconnaissance";
import {
  ReaderCheckpointKind,
  ReaderCoverageDisposition,
  ReaderCoverageReason,
  ReaderEvidenceKind,
  ReaderHandoffStatus,
  ReaderMode,
  ReaderNoteStatus,
  ReaderSessionStatus,
  ReaderSourceType,
  type ReaderCoverageRange,
  type ReaderCoverageSummary,
  type ReaderEvidenceMetadata,
  type ReaderGoal,
  type ReaderHandoff,
  type ReaderLineRange,
  type ReaderNote,
  type ReaderSession,
  type ReaderSourceRef,
  ReaderStatementKind,
} from "@/lib/reader/types";

const DEFAULT_READER_MODEL = "gpt-4.1-mini";
const MAX_READER_STEPS = 24;
const DEFAULT_SEARCH_CONTEXT_LINES = 2;
const DEFAULT_SEARCH_MAX_HITS = 8;

const lineRangeBaseSchema = z.object({
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
});

const lineRangeSchema = lineRangeBaseSchema.refine(
  (value) => value.startLine <= value.endLine,
  {
    message: "startLine must be <= endLine",
  }
);

const rangeRefSchema = lineRangeBaseSchema.extend({
  startOffset: z.number().int().min(0).optional(),
  endOffset: z.number().int().min(0).optional(),
}).refine((value) => value.startLine <= value.endLine, {
  message: "startLine must be <= endLine",
});

const toolRangeRefSchema = lineRangeBaseSchema.extend({
  startOffset: z.number().int().min(0).nullable(),
  endOffset: z.number().int().min(0).nullable(),
}).refine((value) => value.startLine <= value.endLine, {
  message: "startLine must be <= endLine",
});

const sourceRefSchema = z.discriminatedUnion("sourceType", [
  z.object({
    sourceId: z.string().uuid(),
    sourceType: z.literal(ReaderSourceType.BookRawContent),
    title: z.string().optional(),
    bookId: z.string().uuid(),
    documentId: z.null().optional(),
    chunkId: z.null().optional(),
  }),
  z.object({
    sourceId: z.string().uuid(),
    sourceType: z.literal(ReaderSourceType.Document),
    title: z.string().optional(),
    documentId: z.string().uuid(),
    bookId: z.string().uuid().nullable().optional(),
    chunkId: z.null().optional(),
  }),
  z.object({
    sourceId: z.string().uuid(),
    sourceType: z.literal(ReaderSourceType.Chunk),
    title: z.string().optional(),
    chunkId: z.string().uuid(),
    documentId: z.string().uuid(),
    bookId: z.string().uuid().nullable().optional(),
  }),
]);

const toolSourceRefSchema = z.discriminatedUnion("sourceType", [
  z.object({
    sourceId: z.string().uuid(),
    sourceType: z.literal(ReaderSourceType.BookRawContent),
    title: z.string().nullable(),
    bookId: z.string().uuid(),
    documentId: z.null(),
    chunkId: z.null(),
  }),
  z.object({
    sourceId: z.string().uuid(),
    sourceType: z.literal(ReaderSourceType.Document),
    title: z.string().nullable(),
    documentId: z.string().uuid(),
    bookId: z.string().uuid().nullable(),
    chunkId: z.null(),
  }),
  z.object({
    sourceId: z.string().uuid(),
    sourceType: z.literal(ReaderSourceType.Chunk),
    title: z.string().nullable(),
    chunkId: z.string().uuid(),
    documentId: z.string().uuid(),
    bookId: z.string().uuid().nullable(),
  }),
]);

const goalSchema = z.object({
  mode: z.nativeEnum(ReaderMode),
  prompt: z.string().min(1),
  questions: z.array(z.string()).optional(),
  targetEntities: z.array(z.string()).optional(),
  stopWhenSatisfied: z.boolean().optional(),
  requiredCoverage: z
    .object({
      minimumLineCoveragePercent: z.number().min(0).max(100).optional(),
      requireEndToEndRead: z.boolean().optional(),
    })
    .optional(),
});

const evidenceSchema = z.object({
  id: z.string().min(1).optional(),
  source: sourceRefSchema,
  range: rangeRefSchema,
  kind: z.nativeEnum(ReaderEvidenceKind),
  statementKind: z.nativeEnum(ReaderStatementKind),
  coverageDisposition: z.nativeEnum(ReaderCoverageDisposition),
  quote: z.string().optional(),
  note: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  capturedViaTool: z.string().optional(),
});

const toolEvidenceSchema = z.object({
  id: z.string().min(1).nullable(),
  source: toolSourceRefSchema,
  range: toolRangeRefSchema,
  kind: z.nativeEnum(ReaderEvidenceKind),
  statementKind: z.nativeEnum(ReaderStatementKind),
  coverageDisposition: z.nativeEnum(ReaderCoverageDisposition),
  quote: z.string().nullable(),
  note: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  capturedViaTool: z.string().nullable(),
});

const noteCoverageSchema = lineRangeBaseSchema.extend({
  startOffset: z.number().int().min(0).optional(),
  endOffset: z.number().int().min(0).optional(),
  source: sourceRefSchema,
  disposition: z.nativeEnum(ReaderCoverageDisposition),
  reason: z.nativeEnum(ReaderCoverageReason),
  toolName: z.string().optional(),
  recordedAt: z.string().datetime().optional(),
}).refine((value) => value.startLine <= value.endLine, {
  message: "startLine must be <= endLine",
});

const toolNoteCoverageSchema = lineRangeBaseSchema.extend({
  startOffset: z.number().int().min(0).nullable(),
  endOffset: z.number().int().min(0).nullable(),
  source: toolSourceRefSchema,
  disposition: z.nativeEnum(ReaderCoverageDisposition),
  reason: z.nativeEnum(ReaderCoverageReason),
  toolName: z.string().nullable(),
  recordedAt: z.string().datetime().nullable(),
}).refine((value) => value.startLine <= value.endLine, {
  message: "startLine must be <= endLine",
});

const checkpointSchema = z.object({
  kind: z.nativeEnum(ReaderCheckpointKind),
  readSummary: z.string().min(1),
  skippedSummary: z.string().min(1),
  remainingGapsSummary: z.string().min(1),
  readRanges: z.array(lineRangeSchema),
  skippedRanges: z.array(lineRangeSchema),
  remainingGapRanges: z.array(lineRangeSchema),
});

const toolCheckpointSchema = z.object({
  kind: z.nativeEnum(ReaderCheckpointKind),
  readSummary: z.string().min(1),
  skippedSummary: z.string().min(1),
  remainingGapsSummary: z.string().min(1),
  readRanges: z.array(lineRangeSchema),
  skippedRanges: z.array(lineRangeSchema),
  remainingGapRanges: z.array(lineRangeSchema),
});

const noteToolSchema = z.object({
  noteId: z.string().uuid().optional(),
  status: z.nativeEnum(ReaderNoteStatus),
  summary: z.string().min(1),
  facts: z.array(z.string()),
  inferences: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  followUpActions: z.array(z.string()),
  evidence: z.array(evidenceSchema),
  checkpoint: checkpointSchema.optional(),
  coverage: z.array(noteCoverageSchema).min(1),
});

const toolNoteToolSchema = z.object({
  noteId: z.string().nullable(),
  status: z.nativeEnum(ReaderNoteStatus),
  summary: z.string().min(1),
  facts: z.array(z.string()),
  inferences: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  followUpActions: z.array(z.string()),
  evidence: z.array(toolEvidenceSchema),
  checkpoint: toolCheckpointSchema.nullable(),
  coverage: z.array(toolNoteCoverageSchema).min(1).nullable(),
});

const jumpToLineToolSchema = z.object({
  requestedLine: z.number().int().min(1),
  windowLines: z.number().int().min(1).nullable(),
  placement: z.enum(["start", "center"]).nullable(),
});

const skipLinesToolSchema = z.object({
  count: z.number().int().min(0),
  fromLine: z.number().int().min(1).nullable(),
});

const searchPhrasesToolSchema = z.object({
  query: z.string().trim().min(1),
  maxHits: z.number().int().min(1).max(20).nullable(),
  contextLines: z.number().int().min(0).max(6).nullable(),
});

const jumpToGapToolSchema = z.object({
  gapIndex: z.number().int().min(0).nullable(),
  windowLines: z.number().int().min(1).max(200).nullable(),
});

const finishToolSchema = z.object({
  cursor: lineRangeSchema.nullable(),
});

const handoffDraftSchema = z.object({
  status: z.nativeEnum(ReaderHandoffStatus),
  executiveSummary: z.string().min(1),
  conclusions: z.array(
    z.object({
      title: z.string().min(1),
      summary: z.string().min(1),
      statementKind: z.nativeEnum(ReaderStatementKind),
      confidence: z.number().min(0).max(1).optional(),
      evidenceIds: z.array(z.string()),
    })
  ),
  gaps: z.array(z.string()),
  caveats: z.array(z.string()),
  limitations: z.array(z.string()),
  nextQuestions: z.array(z.string()),
});

const startSessionInputSchema = z.union([
  z.object({
    sessionId: z.string().uuid(),
    model: z.string().min(1).optional(),
  }),
  z.object({
    source: sourceRefSchema,
    goal: goalSchema,
    model: z.string().min(1).optional(),
  }),
]);

export const readerOrchestrationInputSchema = startSessionInputSchema;

export type ReaderOrchestrationInput = z.input<typeof startSessionInputSchema>;

type ReaderOrchestrationStage =
  | "recon"
  | "reading"
  | "synthesis"
  | "finish"
  | "unknown";

export type RunReaderOrchestrationOptions = {
  onEvent?: ReaderSessionEventSink;
};

export type ReaderOrchestrationResult = {
  session: ReaderSession;
  notes: ReaderNote[];
  handoff: ReaderHandoff | null;
  startedNewSession: boolean;
  model: string;
  usage?: {
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
};

function isTerminalStatus(status: ReaderSessionStatus) {
  return (
    status === ReaderSessionStatus.Complete ||
    status === ReaderSessionStatus.Partial ||
    status === ReaderSessionStatus.Cancelled
  );
}

function toJsonText(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function parseLooseJson(text: string) {
  const trimmed = text.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  return JSON.parse(withoutFence.trim());
}

function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripNulls(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== null)
        .map(([key, entryValue]) => [key, stripNulls(entryValue)])
    ) as T;
  }

  return value;
}

function isUuid(value: string | null | undefined) {
  return typeof value === "string" && z.string().uuid().safeParse(value).success;
}

function deriveCoverageFromEvidence(evidence: ReaderEvidenceMetadata[]) {
  return evidence.map((item) => ({
    startLine: item.range.startLine,
    endLine: item.range.endLine,
    startOffset: item.range.startOffset,
    endOffset: item.range.endOffset,
    source: item.source,
    disposition: item.coverageDisposition,
    reason:
      item.kind === ReaderEvidenceKind.SearchHit
        ? ReaderCoverageReason.TargetedSearch
        : ReaderCoverageReason.SequentialRead,
    toolName: item.capturedViaTool,
  }));
}

function findLatestNote(session: ReaderSession, notes: ReaderNote[]) {
  if (session.lastNoteId) {
    const found = notes.find((note) => note.id === session.lastNoteId);

    if (found) {
      return found;
    }
  }

  return notes.at(-1) ?? null;
}

function persistableCursor(range?: ReaderLineRange | null) {
  if (!range) {
    return undefined;
  }

  return {
    startLine: range.startLine,
    endLine: range.endLine,
  };
}

function getCursorFromReadResult(result: {
  startLine: number;
  endLine: number;
}): ReaderLineRange {
  return {
    startLine: result.startLine,
    endLine: result.endLine,
  };
}

function getCursorFromSkipResult(result: {
  fromLine: number;
  toLine: number;
}): ReaderLineRange {
  return {
    startLine: result.fromLine,
    endLine: result.toLine,
  };
}

function summarizeCoverageLedger(
  totalLines: number,
  coverage: ReaderCoverageRange[]
): ReaderCoverageSummary {
  const states = new Uint8Array(Math.max(0, totalLines) + 1);
  const priority: Record<ReaderCoverageDisposition, number> = {
    [ReaderCoverageDisposition.Skipped]: 1,
    [ReaderCoverageDisposition.Sampled]: 2,
    [ReaderCoverageDisposition.Read]: 3,
  };

  for (const range of coverage) {
    const startLine = Math.max(1, Math.min(totalLines, range.startLine));
    const endLine = Math.max(1, Math.min(totalLines, range.endLine));

    for (let line = startLine; line <= endLine; line += 1) {
      states[line] = Math.max(states[line] ?? 0, priority[range.disposition]);
    }
  }

  let readLinesCount = 0;
  let sampledLinesCount = 0;
  let skippedLinesCount = 0;
  const gapRanges: ReaderLineRange[] = [];
  let gapStart: number | null = null;

  for (let line = 1; line <= totalLines; line += 1) {
    const state = states[line] ?? 0;

    if (state === 3) {
      readLinesCount += 1;
    } else if (state === 2) {
      sampledLinesCount += 1;
    } else if (state === 1) {
      skippedLinesCount += 1;
    } else if (gapStart === null) {
      gapStart = line;
    }

    if (state !== 0 && gapStart !== null) {
      gapRanges.push({ startLine: gapStart, endLine: line - 1 });
      gapStart = null;
    }
  }

  if (gapStart !== null) {
    gapRanges.push({ startLine: gapStart, endLine: totalLines });
  }

  const visitedLines = readLinesCount + sampledLinesCount + skippedLinesCount;
  const denominator = Math.max(totalLines, 1);

  return {
    totalLines,
    readLines: readLinesCount,
    sampledLines: sampledLinesCount,
    skippedLines: skippedLinesCount,
    unvisitedLines: Math.max(0, totalLines - visitedLines),
    readPercent: Number(((readLinesCount / denominator) * 100).toFixed(2)),
    visitedPercent: Number(((visitedLines / denominator) * 100).toFixed(2)),
    gapRanges,
    isUnvisitedDerived: true,
  };
}

function normalizeEvidence(notes: ReaderNote[]) {
  const evidence: ReaderEvidenceMetadata[] = [];

  for (const note of notes) {
    note.evidence.forEach((item, index) => {
      evidence.push({
        ...item,
        id: item.id ?? `${note.id}:e${index + 1}`,
      });
    });
  }

  return evidence;
}

function buildCoverageDigest(summary: ReaderCoverageSummary) {
  const gaps =
    summary.gapRanges.length > 0
      ? summary.gapRanges.map((range) => `L${range.startLine}-${range.endLine}`).join(", ")
      : "none";

  return [
    `totalLines=${summary.totalLines}`,
    `readLines=${summary.readLines}`,
    `sampledLines=${summary.sampledLines}`,
    `skippedLines=${summary.skippedLines}`,
    `unvisitedLines=${summary.unvisitedLines}`,
    `readPercent=${summary.readPercent}`,
    `visitedPercent=${summary.visitedPercent}`,
    `gapRanges=${gaps}`,
  ].join("\n");
}

function buildNotesDigest(notes: ReaderNote[]) {
  return notes
    .map((note) => {
      const checkpoint = note.checkpoint
        ? {
            kind: note.checkpoint.kind,
            readRanges: note.checkpoint.readRanges,
            skippedRanges: note.checkpoint.skippedRanges,
            remainingGapRanges: note.checkpoint.remainingGapRanges,
          }
        : null;

      return toJsonText({
        noteId: note.id,
        ordinal: note.ordinal,
        status: note.status,
        summary: note.summary,
        facts: note.facts,
        inferences: note.inferences,
        unresolvedQuestions: note.unresolvedQuestions,
        followUpActions: note.followUpActions,
        checkpoint,
        evidence: note.evidence.map((item, index) => ({
          id: item.id ?? `${note.id}:e${index + 1}`,
          kind: item.kind,
          statementKind: item.statementKind,
          range: item.range,
          quote: item.quote,
          note: item.note,
          confidence: item.confidence,
        })),
      });
    })
    .join("\n\n");
}

async function searchSourcePhrases(args: {
  source: ReaderSourceRef;
  query: string;
  maxHits?: number;
  contextLines?: number;
}) {
  const normalizedQuery = args.query.trim();

  if (normalizedQuery.length === 0) {
    throw new Error("searchPhrases requires a non-empty query.");
  }

  const maxHits = Math.min(Math.max(args.maxHits ?? DEFAULT_SEARCH_MAX_HITS, 1), 20);
  const contextLines = Math.min(Math.max(args.contextLines ?? DEFAULT_SEARCH_CONTEXT_LINES, 0), 6);
  const metadata = await readerSourceAdapter.getMetadata(args.source);
  const queryLower = normalizedQuery.toLocaleLowerCase();
  const hits: Array<{
    line: number;
    startLine: number;
    endLine: number;
    excerpt: string;
    preview: string;
  }> = [];

  for (
    let windowStart = 1;
    windowStart <= metadata.totalLines && hits.length < maxHits;
    windowStart += MAX_READ_LINES
  ) {
    const windowResult = await readerSourceAdapter.readLines(
      args.source,
      windowStart,
      windowStart + MAX_READ_LINES - 1
    );
    const windowLines = windowResult.text.split("\n");

    for (let index = 0; index < windowLines.length; index += 1) {
      const line = windowLines[index] ?? "";

      if (!line.toLocaleLowerCase().includes(queryLower)) {
        continue;
      }

      const lineNumber = windowResult.startLine + index;
      const startLine = Math.max(1, lineNumber - contextLines);
      const endLine = Math.min(metadata.totalLines, lineNumber + contextLines);
      const excerptWindow = await readerSourceAdapter.readLines(args.source, startLine, endLine);

      hits.push({
        line: lineNumber,
        startLine: excerptWindow.startLine,
        endLine: excerptWindow.endLine,
        excerpt: excerptWindow.text,
        preview: line.trim().slice(0, 220),
      });

      if (hits.length >= maxHits) {
        break;
      }
    }
  }

  return {
    toolName: "searchPhrases" as const,
    query: normalizedQuery,
    maxHits,
    contextLines,
    hitCount: hits.length,
    truncated: hits.length >= maxHits,
    hits,
  };
}

async function findUnvisitedRanges(args: {
  sessionId: string;
  source: ReaderSourceRef;
}) {
  const [metadata, artifacts] = await Promise.all([
    readerSourceAdapter.getMetadata(args.source),
    getReaderSessionArtifacts(args.sessionId),
  ]);
  const summary = summarizeCoverageLedger(metadata.totalLines, artifacts.coverage);

  return {
    totalLines: metadata.totalLines,
    totalCharacters: metadata.totalCharacters,
    gapRanges: summary.gapRanges,
    visitedPercent: summary.visitedPercent,
    unvisitedLines: summary.unvisitedLines,
  };
}

async function resolveSessionContext(
  input: ReaderOrchestrationInput,
  options?: RunReaderOrchestrationOptions
) {
  const parsed = startSessionInputSchema.parse(input);
  const emit = options?.onEvent;

  if ("sessionId" in parsed) {
    const session = await getReaderSession(parsed.sessionId);

    if (!session) {
      throw new Error("Reader session not found");
    }

    await emit?.(
      createReaderSessionEvent("thinking", session.id, {
        stage: "recon",
        message: "Running reconnaissance for the existing reader session.",
      })
    );

    const recon = await runReaderReconnaissance(session.source);

    if (!session.reconSummary) {
      const updatedSession = await updateReaderSession({
        sessionId: session.id,
        status: ReaderSessionStatus.Recon,
        reconSummary: recon.summary,
      });

      if (updatedSession) {
        await emit?.(
          createReaderSessionEvent("status", updatedSession.id, {
            status: updatedSession.status,
            phase: "recon",
            message: "Reader reconnaissance summary refreshed.",
            startedNewSession: false,
          })
        );
      }
    } else {
      await emit?.(
        createReaderSessionEvent("status", session.id, {
          status: session.status,
          phase: "recon",
          message: "Reader reconnaissance summary reused from the persisted session.",
          startedNewSession: false,
        })
      );
    }

    return {
      session:
        session.reconSummary
          ? session
          : ((await getReaderSession(session.id)) ?? session),
      recon,
      model: parsed.model ?? DEFAULT_READER_MODEL,
      startedNewSession: false,
    };
  }

  const session = await createReaderSession({
    source: parsed.source as ReaderSourceRef,
    goal: parsed.goal as ReaderGoal,
    status: ReaderSessionStatus.Recon,
    reconSummary: undefined,
  });

  await emit?.(
    createReaderSessionEvent("thinking", session.id, {
      stage: "recon",
      message: "Running reconnaissance for a new reader session.",
    })
  );
  await emit?.(
    createReaderSessionEvent("status", session.id, {
      status: session.status,
      phase: "recon",
      message: "Reader session created; reconnaissance is starting.",
      startedNewSession: true,
    })
  );

  const recon = await runReaderReconnaissance(parsed.source as ReaderSourceRef);
  const sessionWithRecon =
    (await updateReaderSession({
      sessionId: session.id,
      status: ReaderSessionStatus.Recon,
      reconSummary: recon.summary,
    })) ?? session;

  return {
    session: sessionWithRecon,
    recon,
    model: parsed.model ?? DEFAULT_READER_MODEL,
    startedNewSession: true,
  };
}

async function createReaderTools(args: {
  session: ReaderSession;
  noteCount: number;
  onEvent?: ReaderSessionEventSink;
}) {
  let currentCursor = persistableCursor(args.session.cursor) ?? null;
  let currentNoteCount = args.noteCount;
  let finishEnabled = false;
  const emit = args.onEvent;

  const persistCursor = async (cursor: ReaderLineRange) => {
    currentCursor = cursor;
    await updateReaderSession({
      sessionId: args.session.id,
      cursor,
    });
  };

  const tools = {
    readLines: tool({
      description: "Read an inclusive line range from the current reader source.",
      parameters: z.object({
        startLine: z.number().int().min(1),
        endLine: z.number().int().min(1),
      }),
      execute: async ({ startLine, endLine }) => {
        await emit?.(
          createReaderSessionEvent("tool_call", args.session.id, {
            toolName: "readLines",
            input: { startLine, endLine },
          })
        );

        try {
          const result = await readLines({
            session: {
              id: args.session.id,
              source: args.session.source,
              cursor: currentCursor ?? undefined,
            },
            startLine,
            endLine,
          });

          await persistCursor(getCursorFromReadResult(result));
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "readLines",
              ok: true,
              result,
            })
          );

          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "readLines",
              ok: false,
              errorMessage: error instanceof Error ? error.message : "Unknown tool error",
            })
          );

          throw error;
        }
      },
    }),
    jumpToLine: tool({
      description: "Read a bounded window starting from or centered on a target line.",
      parameters: jumpToLineToolSchema,
      execute: async ({ requestedLine, windowLines, placement }) => {
        await emit?.(
          createReaderSessionEvent("tool_call", args.session.id, {
            toolName: "jumpToLine",
            input: { requestedLine, windowLines, placement },
          })
        );

        try {
          const result = await jumpToLine({
            session: {
              id: args.session.id,
              source: args.session.source,
              cursor: currentCursor ?? undefined,
            },
            requestedLine,
            windowLines: windowLines ?? undefined,
            placement: placement ?? undefined,
          });

          await persistCursor(getCursorFromReadResult(result));
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "jumpToLine",
              ok: true,
              result,
            })
          );

          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "jumpToLine",
              ok: false,
              errorMessage: error instanceof Error ? error.message : "Unknown tool error",
            })
          );

          throw error;
        }
      },
    }),
    skipLines: tool({
      description: "Advance coverage without reading the skipped lines.",
      parameters: skipLinesToolSchema,
      execute: async ({ count, fromLine }) => {
        await emit?.(
          createReaderSessionEvent("tool_call", args.session.id, {
            toolName: "skipLines",
            input: { count, fromLine },
          })
        );

        try {
          const result = await skipLines({
            session: {
              id: args.session.id,
              source: args.session.source,
              cursor: currentCursor ?? undefined,
            },
            count,
            fromLine: fromLine ?? undefined,
          });

          await persistCursor(getCursorFromSkipResult(result));
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "skipLines",
              ok: true,
              result,
            })
          );

          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "skipLines",
              ok: false,
              errorMessage: error instanceof Error ? error.message : "Unknown tool error",
            })
          );

          throw error;
        }
      },
    }),
    inspectSlice: tool({
      description: "Inspect a bounded character slice with line metadata.",
      parameters: z.object({
        startOffset: z.number().int().min(0),
        endOffset: z.number().int().min(0),
      }),
      execute: async ({ startOffset, endOffset }) => {
        await emit?.(
          createReaderSessionEvent("tool_call", args.session.id, {
            toolName: "inspectSlice",
            input: { startOffset, endOffset },
          })
        );

        try {
          const result = await inspectSlice({
            session: {
              id: args.session.id,
              source: args.session.source,
              cursor: currentCursor ?? undefined,
            },
            startOffset,
            endOffset,
          });

          await persistCursor(getCursorFromReadResult(result));
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "inspectSlice",
              ok: true,
              result,
            })
          );

          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "inspectSlice",
              ok: false,
              errorMessage: error instanceof Error ? error.message : "Unknown tool error",
            })
          );

          throw error;
        }
      },
    }),
    searchPhrases: tool({
      description:
        "Find lexical phrase matches in the current source and return local line context around each hit.",
      parameters: searchPhrasesToolSchema,
      execute: async ({ query, maxHits, contextLines }) => {
        await emit?.(
          createReaderSessionEvent("tool_call", args.session.id, {
            toolName: "searchPhrases",
            input: { query, maxHits, contextLines },
          })
        );

        try {
          const result = await searchSourcePhrases({
            source: args.session.source,
            query,
            maxHits: maxHits ?? undefined,
            contextLines: contextLines ?? undefined,
          });

          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "searchPhrases",
              ok: true,
              result,
            })
          );

          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "searchPhrases",
              ok: false,
              errorMessage: error instanceof Error ? error.message : "Unknown tool error",
            })
          );

          throw error;
        }
      },
    }),
    jumpToGap: tool({
      description:
        "Jump to one of the currently unvisited ranges derived from the persisted session coverage ledger.",
      parameters: jumpToGapToolSchema,
      execute: async ({ gapIndex, windowLines }) => {
        await emit?.(
          createReaderSessionEvent("tool_call", args.session.id, {
            toolName: "jumpToGap",
            input: { gapIndex, windowLines },
          })
        );

        try {
          const gapState = await findUnvisitedRanges({
            sessionId: args.session.id,
            source: args.session.source,
          });

          if (gapState.gapRanges.length === 0) {
            throw new Error("No unvisited ranges remain for this session.");
          }

          const selectedGapIndex = Math.min(
            Math.max(gapIndex ?? 0, 0),
            gapState.gapRanges.length - 1
          );
          const selectedGap = gapState.gapRanges[selectedGapIndex];
          const jumpResult = await jumpToLine({
            session: {
              id: args.session.id,
              source: args.session.source,
              cursor: currentCursor ?? undefined,
            },
            requestedLine: selectedGap.startLine,
            windowLines: windowLines ?? undefined,
            placement: "start",
          });

          await persistCursor(getCursorFromReadResult(jumpResult));

          const result = {
            toolName: "jumpToGap" as const,
            selectedGapIndex,
            selectedGap,
            remainingGapCount: gapState.gapRanges.length,
            visitedPercent: gapState.visitedPercent,
            jump: jumpResult,
          };

          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "jumpToGap",
              ok: true,
              result,
            })
          );

          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "jumpToGap",
              ok: false,
              errorMessage: error instanceof Error ? error.message : "Unknown tool error",
            })
          );

          throw error;
        }
      },
    }),
    saveNotes: tool({
      description:
        "Persist a structured reader note with evidence, coverage ranges, and an optional checkpoint.",
      parameters: toolNoteToolSchema,
      execute: async (input) => {
        await emit?.(
          createReaderSessionEvent("tool_call", args.session.id, {
            toolName: "saveNotes",
            input,
          })
        );

        const normalizedToolInput = {
          ...input,
          noteId: isUuid(input.noteId) ? input.noteId : null,
          coverage:
            Array.isArray(input.coverage) && input.coverage.length > 0
              ? input.coverage
              : deriveCoverageFromEvidence(noteToolSchema.shape.evidence.parse(stripNulls(input.evidence))),
        };
        const normalizedInput = noteToolSchema.parse(stripNulls(normalizedToolInput));

        const existingOrdinal = normalizedInput.noteId
          ? (await getReaderSessionArtifacts(args.session.id)).notes.find(
              (note) => note.id === normalizedInput.noteId
            )?.ordinal
          : undefined;
        const ordinal = existingOrdinal ?? currentNoteCount;
        const payload: SaveNotesInput = {
          ...normalizedInput,
          sessionId: args.session.id,
          ordinal,
        };

        try {
          const result = await persistReaderNotes(payload);

          if (!normalizedInput.noteId) {
            currentNoteCount += 1;
          }

          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "saveNotes",
              ok: true,
              result,
            })
          );
          await emit?.(
            createReaderSessionEvent("note_saved", args.session.id, {
              noteId: result.noteId,
              ordinal,
              status: normalizedInput.status,
              checkpointKind: normalizedInput.checkpoint?.kind,
              coverageRangeCount: normalizedInput.coverage.length,
            })
          );
          await emit?.(
            createReaderSessionEvent("coverage", args.session.id, {
              noteId: result.noteId,
              toolName: "saveNotes",
              coverage: normalizedInput.coverage,
            })
          );

          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "saveNotes",
              ok: false,
              errorMessage: error instanceof Error ? error.message : "Unknown tool error",
            })
          );

          throw error;
        }
      },
    }),
    finish: tool({
      description:
        "Close the reader session formally after the server has persisted a final handoff.",
      parameters: finishToolSchema,
      execute: async ({ cursor }) => {
        await emit?.(
          createReaderSessionEvent("tool_call", args.session.id, {
            toolName: "finish",
            input: { cursor },
          })
        );

        if (!finishEnabled) {
          const error = new Error(
            "Reader finish is not yet available. Save a final checkpoint and wait for server synthesis first."
          );

          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "finish",
              ok: false,
              errorMessage: error.message,
            })
          );

          throw error;
        }

        try {
          const result = await finishReaderSession({
            sessionId: args.session.id,
            cursor: cursor ?? currentCursor ?? undefined,
          });

          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "finish",
              ok: true,
              result,
            })
          );

          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "finish",
              ok: false,
              errorMessage: error instanceof Error ? error.message : "Unknown tool error",
            })
          );

          throw error;
        }
      },
    }),
  };

  return {
    tools,
    enableFinish() {
      finishEnabled = true;
    },
    getCursor() {
      return currentCursor;
    },
  };
}

async function synthesizeHandoff(args: {
  session: ReaderSession;
  recon: Awaited<ReturnType<typeof runReaderReconnaissance>>;
  notes: ReaderNote[];
  coverageSummary: ReaderCoverageSummary;
  model: string;
}) {
  const notesDigest = buildNotesDigest(args.notes);
  const coverageDigest = buildCoverageDigest(args.coverageSummary);
  const synthesis = await generateText({
    model: openai(args.model),
    system: [
      "Return valid JSON only.",
      "Do not wrap the response in markdown fences.",
      "Do not omit required fields.",
    ].join("\n"),
    prompt: buildReaderSynthesisPrompt({
      session: args.session,
      recon: args.recon,
      notesDigest,
      coverageDigest,
    }),
    temperature: 0.1,
    maxTokens: 1_400,
  });

  return {
    draft: handoffDraftSchema.parse(parseLooseJson(synthesis.text)),
    usage: synthesis.usage,
  };
}

export async function runReaderOrchestration(
  input: ReaderOrchestrationInput,
  options?: RunReaderOrchestrationOptions
): Promise<ReaderOrchestrationResult> {
  const emit = options?.onEvent;
  let currentStage: ReaderOrchestrationStage = "recon";
  let context: Awaited<ReturnType<typeof resolveSessionContext>> | null = null;
  const initialSessionId =
    typeof input === "object" &&
    input !== null &&
    "sessionId" in input &&
    z.string().uuid().safeParse(input.sessionId).success
      ? input.sessionId
      : null;
  let sessionId = initialSessionId;

  try {
    context = await resolveSessionContext(input, options);
    sessionId = context.session.id;

    if (isTerminalStatus(context.session.status)) {
      const artifacts = await getReaderSessionArtifacts(sessionId);

      if (!artifacts.session) {
        throw new Error("Reader session disappeared during orchestration");
      }

      await emit?.(
        createReaderSessionEvent("status", artifacts.session.id, {
          status: artifacts.session.status,
          phase: "terminal",
          message: "Reader session was already terminal; returning persisted artifacts.",
          startedNewSession: context.startedNewSession,
        })
      );

      return {
        session: artifacts.session,
        notes: artifacts.notes,
        handoff: artifacts.handoff,
        startedNewSession: context.startedNewSession,
        model: context.model,
      };
    }

    const initialArtifacts = await getReaderSessionArtifacts(sessionId);
    const currentSession = initialArtifacts.session ?? context.session;
    const toolRuntime = await createReaderTools({
      session: currentSession,
      noteCount: initialArtifacts.notes.length,
      onEvent: emit,
    });

    currentStage = "reading";
    await emit?.(
      createReaderSessionEvent("thinking", sessionId, {
        stage: "reading",
        message: "Reader orchestration is entering the tool-driven reading loop.",
      })
    );

    const readingSession = await updateReaderSession({
      sessionId,
      status: ReaderSessionStatus.Reading,
      reconSummary: context.recon.summary,
      cursor: persistableCursor(currentSession.cursor),
    });

    if (readingSession) {
      await emit?.(
        createReaderSessionEvent("status", sessionId, {
          status: readingSession.status,
          phase: "reading",
          message: "Reader session is now reading.",
          startedNewSession: context.startedNewSession,
        })
      );
    }

    const readingResult = await generateText({
      model: openai(context.model),
      system: buildReaderSystemPrompt(),
      prompt: buildReaderRunPrompt({
        recon: context.recon,
        session: currentSession,
        existingNoteCount: initialArtifacts.notes.length,
      }),
      tools: toolRuntime.tools,
      maxSteps: MAX_READER_STEPS,
      maxTokens: 1_200,
      temperature: 0.2,
    });

    const artifactsAfterReading = await getReaderSessionArtifacts(sessionId);
    const sessionAfterReading = artifactsAfterReading.session;

    if (!sessionAfterReading) {
      throw new Error("Reader session missing after reading loop");
    }

    const latestNote = findLatestNote(sessionAfterReading, artifactsAfterReading.notes);

    if (
      !latestNote ||
      latestNote.checkpoint?.kind !== READER_FINAL_CHECKPOINT_KIND
    ) {
      throw new Error(
        "Reader orchestration requires a persisted final checkpoint note before synthesis"
      );
    }

    if (!readingResult.text.includes(READER_SYNTHESIS_READY_SENTINEL)) {
      throw new Error(
        "Reader orchestration did not receive the synthesis-ready sentinel from the model"
      );
    }

    await updateReaderSession({
      sessionId,
      status: ReaderSessionStatus.Synthesizing,
      cursor: persistableCursor(toolRuntime.getCursor() ?? sessionAfterReading.cursor),
    });

    currentStage = "synthesis";
    await emit?.(
      createReaderSessionEvent("thinking", sessionId, {
        stage: "synthesis",
        message: "Reading loop completed; synthesizing the persisted notes into a handoff.",
      })
    );
    await emit?.(
      createReaderSessionEvent("status", sessionId, {
        status: ReaderSessionStatus.Synthesizing,
        phase: "synthesis",
        message: "Reader session is synthesizing the final handoff.",
        startedNewSession: context.startedNewSession,
      })
    );

    const coverageSummary = summarizeCoverageLedger(
      context.recon.stats.totalLines,
      artifactsAfterReading.coverage
    );
    const normalizedEvidence = normalizeEvidence(artifactsAfterReading.notes);
    const synthesis = await synthesizeHandoff({
      session: sessionAfterReading,
      recon: context.recon,
      notes: artifactsAfterReading.notes,
      coverageSummary,
      model: context.model,
    });
    const handoff = await saveReaderHandoff({
      sessionId,
      status: synthesis.draft.status,
      executiveSummary: synthesis.draft.executiveSummary,
      conclusions: synthesis.draft.conclusions.map((item) => ({
        ...item,
        statementKind: item.statementKind,
      })),
      gaps: synthesis.draft.gaps,
      caveats: synthesis.draft.caveats,
      limitations: synthesis.draft.limitations,
      nextQuestions: synthesis.draft.nextQuestions,
      evidence: normalizedEvidence,
      coverageSummary,
    });

    await emit?.(
      createReaderSessionEvent("handoff_ready", sessionId, {
        handoffId: handoff.id,
        status: handoff.status,
        executiveSummary: handoff.executiveSummary,
        coverageSummary: handoff.coverageSummary,
      })
    );

    toolRuntime.enableFinish();

    currentStage = "finish";
    await emit?.(
      createReaderSessionEvent("thinking", sessionId, {
        stage: "finish",
        message: "Final handoff persisted; requesting formal session finish.",
      })
    );

    await generateText({
      model: openai(context.model),
      system: buildReaderSystemPrompt(),
      prompt: buildReaderFinishPrompt(sessionId),
      tools: { finish: toolRuntime.tools.finish },
      toolChoice: { type: "tool", toolName: "finish" },
      experimental_activeTools: ["finish"],
      maxSteps: 2,
      maxTokens: 200,
      temperature: 0,
    });

    const finalArtifacts = await getReaderSessionArtifacts(sessionId);

    if (!finalArtifacts.session) {
      throw new Error("Reader session missing after finish");
    }

    await emit?.(
      createReaderSessionEvent("status", sessionId, {
        status: finalArtifacts.session.status,
        phase: "terminal",
        message: "Reader session finished successfully.",
        startedNewSession: context.startedNewSession,
      })
    );

    return {
      session: finalArtifacts.session,
      notes: finalArtifacts.notes,
      handoff: finalArtifacts.handoff ?? handoff,
      startedNewSession: context.startedNewSession,
      model: context.model,
      usage: {
        totalTokens:
          (readingResult.usage?.totalTokens ?? 0) +
          (synthesis.usage?.totalTokens ?? 0),
        inputTokens:
          (readingResult.usage?.promptTokens ?? 0) +
          (synthesis.usage?.promptTokens ?? 0),
        outputTokens:
          (readingResult.usage?.completionTokens ?? 0) +
          (synthesis.usage?.completionTokens ?? 0),
      },
    };
  } catch (error) {
    if (!sessionId) {
      throw error;
    }

    const latestSession = await getReaderSession(sessionId);

    const failedSession = latestSession
      ? await updateReaderSession({
          sessionId,
          status: ReaderSessionStatus.Failed,
          cursor: persistableCursor(
            latestSession.cursor ?? context?.session.cursor ?? null
          ),
        })
      : null;

    await emit?.(
      createReaderSessionEvent("error", sessionId, {
        stage: currentStage,
        message: error instanceof Error ? error.message : "Unknown reader orchestration error",
      })
    );

    if (failedSession) {
      await emit?.(
        createReaderSessionEvent("status", sessionId, {
          status: failedSession.status,
          phase: "terminal",
          message: "Reader session failed.",
          startedNewSession: context?.startedNewSession ?? false,
        })
      );
    }

    throw error;
  }
}