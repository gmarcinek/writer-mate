import "server-only";

import { z } from "zod";
import {
  ReaderCoverageDisposition,
  ReaderEvidenceKind,
  ReaderHandoffStatus,
  ReaderMode,
  ReaderNoteStatus,
  ReaderSessionStatus,
  ReaderSourceType,
  ReaderStatementKind,
} from "@/lib/reader/types";
import type { ReaderSessionEventSink } from "@/lib/reader/events";
import type { ReaderSession, ReaderNote, ReaderHandoff } from "@/lib/reader/types";

export const DEFAULT_READER_MODEL = "gpt-4.1-mini";
export const MAX_READER_STEPS = 24;
export const DEFAULT_SEARCH_CONTEXT_LINES = 2;
export const DEFAULT_SEARCH_MAX_HITS = 8;

export const lineRangeBaseSchema = z.object({
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
});

export const lineRangeSchema = lineRangeBaseSchema.refine(
  (value) => value.startLine <= value.endLine,
  { message: "startLine must be <= endLine" }
);

export const rangeRefSchema = lineRangeBaseSchema
  .extend({
    startOffset: z.number().int().min(0).optional(),
    endOffset: z.number().int().min(0).optional(),
  })
  .refine((value) => value.startLine <= value.endLine, {
    message: "startLine must be <= endLine",
  });

export const toolRangeRefSchema = lineRangeBaseSchema
  .extend({
    startOffset: z.number().int().min(0).nullable(),
    endOffset: z.number().int().min(0).nullable(),
  })
  .refine((value) => value.startLine <= value.endLine, {
    message: "startLine must be <= endLine",
  });

export const sourceRefSchema = z.discriminatedUnion("sourceType", [
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

export const toolSourceRefSchema = z.discriminatedUnion("sourceType", [
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

export const goalSchema = z.object({
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

export const evidenceSchema = z.object({
  id: z.string().min(1).optional(),
  source: sourceRefSchema,
  range: rangeRefSchema,
  kind: z.nativeEnum(ReaderEvidenceKind),
  statementKind: z.nativeEnum(ReaderStatementKind),
  coverageDisposition: z.nativeEnum(ReaderCoverageDisposition),
  quote: z.string().max(240).optional(),
  note: z.string().max(240).optional(),
  confidence: z.number().min(0).max(1).optional(),
  capturedViaTool: z.string().max(64).optional(),
});

export const toolEvidenceSchema = z.object({
  id: z.string().min(1).nullable(),
  source: toolSourceRefSchema,
  range: toolRangeRefSchema,
  kind: z.nativeEnum(ReaderEvidenceKind),
  statementKind: z.nativeEnum(ReaderStatementKind),
  coverageDisposition: z.nativeEnum(ReaderCoverageDisposition),
  quote: z.string().max(240).nullable(),
  note: z.string().max(240).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  capturedViaTool: z.string().max(64).nullable(),
});

export const noteToolSchema = z.object({
  noteId: z.string().uuid().optional(),
  status: z.nativeEnum(ReaderNoteStatus),
  summary: z.string().min(1).max(800),
  facts: z.array(z.string().max(240)).max(8),
  inferences: z.array(z.string().max(240)).max(6),
  unresolvedQuestions: z.array(z.string().max(240)).max(5),
  followUpActions: z.array(z.string().max(240)).max(5),
  evidence: z.array(evidenceSchema).max(4),
});

export const toolNoteToolSchema = z.object({
  noteId: z.string().nullable(),
  status: z.nativeEnum(ReaderNoteStatus),
  summary: z.string().min(1).max(800),
  facts: z.array(z.string().max(240)).max(8),
  inferences: z.array(z.string().max(240)).max(6),
  unresolvedQuestions: z.array(z.string().max(240)).max(5),
  followUpActions: z.array(z.string().max(240)).max(5),
  evidence: z.array(toolEvidenceSchema).max(4),
});

export const jumpToLineToolSchema = z.object({
  requestedLine: z.number().int().min(1),
  windowLines: z.number().int().min(1).nullable(),
  placement: z.enum(["start", "center"]).nullable(),
});

export const skipLinesToolSchema = z.object({
  count: z.number().int().min(0),
  fromLine: z.number().int().min(1).nullable(),
});

export const searchPhrasesToolSchema = z.object({
  query: z.string().trim().min(1),
  maxHits: z.number().int().min(1).max(20).nullable(),
  contextLines: z.number().int().min(0).max(6).nullable(),
});

export const jumpToGapToolSchema = z.object({
  gapIndex: z.number().int().min(0).nullable(),
  windowLines: z.number().int().min(1).max(3000).nullable(),
});

export const finishToolSchema = z.object({
  cursor: lineRangeSchema.nullable(),
});

export const handoffDraftSchema = z.object({
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

export const startSessionInputSchema = z.union([
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

export type ReaderOrchestrationStage =
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
