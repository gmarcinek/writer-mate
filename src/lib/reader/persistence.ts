import "server-only";

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  readerCoverageRanges,
  readerHandoffs,
  readerNotes,
  readerSessions,
} from "@/lib/schema";
import {
  ReaderCheckpointKind,
  ReaderCoverageDisposition,
  ReaderCoverageReason,
  ReaderEvidenceKind,
  ReaderHandoffStatus,
  ReaderMode,
  ReaderNoteStatus,
  ReaderReconContentType,
  ReaderReconStrategyHint,
  ReaderSessionStatus,
  ReaderSourceType,
  ReaderStatementKind,
  type ReaderCoverageRange,
  type ReaderCoverageSummary,
  type ReaderCheckpoint,
  type ReaderEvidenceMetadata,
  type ReaderGoal,
  type ReaderHandoff,
  type ReaderLineRange,
  type ReaderNote,
  type ReaderSession,
  type ReaderSourceRef,
} from "@/lib/reader/types";

type TimestampInput = Date | string;

type CreateReaderSessionInput = {
  source: ReaderSourceRef;
  goal: ReaderGoal;
  status?: ReaderSessionStatus;
  cursor?: ReaderLineRange;
  reconSummary?: ReaderSession["reconSummary"];
  coverageSummary?: ReaderCoverageSummary;
  startedAt?: TimestampInput;
  finishedAt?: TimestampInput | null;
};

type UpdateReaderSessionInput = {
  sessionId: string;
  status?: ReaderSessionStatus;
  cursor?: ReaderLineRange | null;
  reconSummary?: ReaderSession["reconSummary"] | null;
  coverageSummary?: ReaderCoverageSummary | null;
  lastNoteId?: string | null;
  handoffId?: string | null;
  finishedAt?: TimestampInput | null;
};

type SaveReaderNoteInput = Omit<
  ReaderNote,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
  createdAt?: TimestampInput;
  updatedAt?: TimestampInput;
};

type SaveReaderHandoffInput = Omit<ReaderHandoff, "id" | "createdAt"> & {
  id?: string;
  createdAt?: TimestampInput;
};

type ReplaceReaderCoverageRangesInput = {
  sessionId: string;
  noteId?: string | null;
  handoffId?: string | null;
  ranges: ReaderCoverageRange[];
};

const lineRangeShape = {
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
};

const lineRangeSchema = z
  .object(lineRangeShape)
  .refine((value) => value.startLine <= value.endLine, {
    message: "startLine must be <= endLine",
  });

const rangeRefShape = {
  ...lineRangeShape,
  startOffset: z.number().int().min(0).optional(),
  endOffset: z.number().int().min(0).optional(),
};

const rangeRefSchema = z
  .object(rangeRefShape)
  .refine((value) => value.startLine <= value.endLine, {
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

const coverageSummarySchema = z.object({
  totalLines: z.number().int().min(0),
  readLines: z.number().int().min(0),
  sampledLines: z.number().int().min(0),
  skippedLines: z.number().int().min(0),
  unvisitedLines: z.number().int().min(0),
  readPercent: z.number().min(0).max(100),
  visitedPercent: z.number().min(0).max(100),
  gapRanges: z.array(lineRangeSchema),
  isUnvisitedDerived: z.literal(true),
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

const evidenceSchema = z.object({
  id: z.string().uuid().optional(),
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

const coverageRangeSchema = z
  .object({
    ...rangeRefShape,
    id: z.string().uuid().optional(),
    sessionId: z.string().uuid(),
    noteId: z.string().uuid().nullable().optional(),
    handoffId: z.string().uuid().nullable().optional(),
    source: sourceRefSchema,
    disposition: z.nativeEnum(ReaderCoverageDisposition),
    reason: z.nativeEnum(ReaderCoverageReason),
    toolName: z.string().optional(),
    recordedAt: z.string().datetime().optional(),
  })
  .refine((value) => value.startLine <= value.endLine, {
    message: "startLine must be <= endLine",
  });

const reconSummarySchema = z
  .object({
    totalLines: z.number().int().min(0),
    totalCharacters: z.number().int().min(0),
    averageLineLength: z.number().min(0).optional(),
    structureHints: z.array(z.string()).optional(),
    samples: z
      .array(
        z
          .object({
            ...rangeRefShape,
            label: z.string(),
          })
          .refine((value) => value.startLine <= value.endLine, {
            message: "startLine must be <= endLine",
          })
      )
      .optional(),
    contentType: z.nativeEnum(ReaderReconContentType).optional(),
    suggestedStrategy: z.nativeEnum(ReaderReconStrategyHint).optional(),
    headingCount: z.number().int().min(0).optional(),
    maxHeadingDepth: z.number().int().min(0).optional(),
  })
  .optional();

const createSessionSchema = z.object({
  source: sourceRefSchema,
  goal: goalSchema,
  status: z.nativeEnum(ReaderSessionStatus).optional(),
  cursor: lineRangeSchema.optional(),
  reconSummary: reconSummarySchema,
  coverageSummary: coverageSummarySchema.optional(),
  startedAt: z.union([z.date(), z.string().datetime()]).optional(),
  finishedAt: z.union([z.date(), z.string().datetime()]).nullable().optional(),
});

const updateSessionSchema = z.object({
  sessionId: z.string().uuid(),
  status: z.nativeEnum(ReaderSessionStatus).optional(),
  cursor: lineRangeSchema.nullable().optional(),
  reconSummary: reconSummarySchema.nullable().optional(),
  coverageSummary: coverageSummarySchema.nullable().optional(),
  lastNoteId: z.string().uuid().nullable().optional(),
  handoffId: z.string().uuid().nullable().optional(),
  finishedAt: z.union([z.date(), z.string().datetime()]).nullable().optional(),
});

const saveNoteSchema = z.object({
  id: z.string().uuid().optional(),
  sessionId: z.string().uuid(),
  status: z.nativeEnum(ReaderNoteStatus),
  ordinal: z.number().int().min(0),
  summary: z.string().min(1),
  facts: z.array(z.string()),
  inferences: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  followUpActions: z.array(z.string()),
  evidence: z.array(evidenceSchema),
  checkpoint: checkpointSchema.optional(),
  coverage: z.array(coverageRangeSchema),
  createdAt: z.union([z.date(), z.string().datetime()]).optional(),
  updatedAt: z.union([z.date(), z.string().datetime()]).optional(),
});

const conclusionSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1),
  summary: z.string().min(1),
  statementKind: z.nativeEnum(ReaderStatementKind),
  confidence: z.number().min(0).max(1).optional(),
  evidenceIds: z.array(z.string().uuid()),
});

const saveHandoffSchema = z.object({
  id: z.string().uuid().optional(),
  sessionId: z.string().uuid(),
  status: z.nativeEnum(ReaderHandoffStatus),
  executiveSummary: z.string().min(1),
  conclusions: z.array(conclusionSchema),
  gaps: z.array(z.string()),
  caveats: z.array(z.string()),
  limitations: z.array(z.string()),
  nextQuestions: z.array(z.string()),
  evidence: z.array(evidenceSchema),
  coverageSummary: coverageSummarySchema,
  createdAt: z.union([z.date(), z.string().datetime()]).optional(),
});

const replaceCoverageSchema = z.object({
  sessionId: z.string().uuid(),
  noteId: z.string().uuid().nullable().optional(),
  handoffId: z.string().uuid().nullable().optional(),
  ranges: z.array(coverageRangeSchema),
});

function toDate(value?: TimestampInput | null): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return value instanceof Date ? value : new Date(value);
}

function toIsoString(value?: Date | null): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return value.toISOString();
}

function serializeSource(source: ReaderSourceRef) {
  return {
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    sourceTitle: source.title,
    bookId: source.bookId ?? null,
    documentId: source.documentId ?? null,
    chunkId: source.chunkId ?? null,
  };
}

function deserializeSource(input: {
  sourceType: string;
  sourceId: string;
  sourceTitle: string | null;
  bookId: string | null;
  documentId: string | null;
  chunkId: string | null;
}): ReaderSourceRef {
  return sourceRefSchema.parse({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    title: input.sourceTitle ?? undefined,
    bookId: input.bookId,
    documentId: input.documentId,
    chunkId: input.chunkId,
  });
}

function mapCoverageRange(
  row: typeof readerCoverageRanges.$inferSelect
): ReaderCoverageRange {
  return coverageRangeSchema.parse({
    id: row.id,
    sessionId: row.sessionId,
    noteId: row.noteId,
    handoffId: row.handoffId,
    source: deserializeSource({
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      sourceTitle: row.sourceTitle,
      bookId: row.bookId,
      documentId: row.documentId,
      chunkId: row.chunkId,
    }),
    startLine: row.startLine,
    endLine: row.endLine,
    startOffset: row.startOffset ?? undefined,
    endOffset: row.endOffset ?? undefined,
    disposition: row.disposition,
    reason: row.reason,
    toolName: row.toolName ?? undefined,
    recordedAt: row.recordedAt.toISOString(),
  });
}

function mapSession(row: typeof readerSessions.$inferSelect): ReaderSession {
  return {
    id: row.id,
    source: deserializeSource({
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      sourceTitle: row.sourceTitle,
      bookId: row.bookId,
      documentId: row.documentId,
      chunkId: row.chunkId,
    }),
    goal: goalSchema.parse(row.goal),
    status: row.status,
    cursor: row.cursor ? lineRangeSchema.parse(row.cursor) : undefined,
    reconSummary: row.reconSummary
      ? reconSummarySchema.parse(row.reconSummary)
      : undefined,
    coverageSummary: row.coverageSummary
      ? coverageSummarySchema.parse(row.coverageSummary)
      : undefined,
    lastNoteId: row.lastNoteId,
    handoffId: row.handoffId,
    startedAt: row.startedAt.toISOString(),
    finishedAt: toIsoString(row.finishedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapNote(
  row: typeof readerNotes.$inferSelect,
  coverage: ReaderCoverageRange[]
): ReaderNote {
  return {
    id: row.id,
    sessionId: row.sessionId,
    status: row.status,
    ordinal: row.ordinal,
    summary: row.summary,
    facts: z.array(z.string()).parse(row.facts),
    inferences: z.array(z.string()).parse(row.inferences),
    unresolvedQuestions: z.array(z.string()).parse(row.unresolvedQuestions),
    followUpActions: z.array(z.string()).parse(row.followUpActions),
    evidence: z.array(evidenceSchema).parse(row.evidence) as ReaderEvidenceMetadata[],
    checkpoint: row.checkpoint
      ? (checkpointSchema.parse(row.checkpoint) as ReaderCheckpoint)
      : undefined,
    coverage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapHandoff(
  row: typeof readerHandoffs.$inferSelect
): ReaderHandoff {
  return {
    id: row.id,
    sessionId: row.sessionId,
    status: row.status,
    executiveSummary: row.executiveSummary,
    conclusions: z.array(conclusionSchema).parse(row.conclusions),
    gaps: z.array(z.string()).parse(row.gaps),
    caveats: z.array(z.string()).parse(row.caveats),
    limitations: z.array(z.string()).parse(row.limitations),
    nextQuestions: z.array(z.string()).parse(row.nextQuestions),
    evidence: z.array(evidenceSchema).parse(row.evidence) as ReaderEvidenceMetadata[],
    coverageSummary: coverageSummarySchema.parse(row.coverageSummary),
    createdAt: row.createdAt.toISOString(),
  };
}

async function getCoverageForScope(params: {
  sessionId: string;
  noteId?: string | null;
  handoffId?: string | null;
}): Promise<ReaderCoverageRange[]> {
  const scopeFilters = [eq(readerCoverageRanges.sessionId, params.sessionId)];

  if (params.noteId !== undefined) {
    scopeFilters.push(
      params.noteId
        ? eq(readerCoverageRanges.noteId, params.noteId)
        : isNull(readerCoverageRanges.noteId)
    );
  }

  if (params.handoffId !== undefined) {
    scopeFilters.push(
      params.handoffId
        ? eq(readerCoverageRanges.handoffId, params.handoffId)
        : isNull(readerCoverageRanges.handoffId)
    );
  }

  const rows = await db
    .select()
    .from(readerCoverageRanges)
    .where(and(...scopeFilters))
    .orderBy(asc(readerCoverageRanges.startLine), asc(readerCoverageRanges.recordedAt));

  return rows.map(mapCoverageRange);
}

export async function createReaderSession(
  input: CreateReaderSessionInput
): Promise<ReaderSession> {
  const parsed = createSessionSchema.parse(input);
  const [row] = await db
    .insert(readerSessions)
    .values({
      ...serializeSource(parsed.source),
      status: parsed.status ?? ReaderSessionStatus.Pending,
      mode: parsed.goal.mode,
      goal: parsed.goal,
      cursor: parsed.cursor,
      reconSummary: parsed.reconSummary,
      coverageSummary: parsed.coverageSummary,
      startedAt: toDate(parsed.startedAt) ?? new Date(),
      finishedAt: toDate(parsed.finishedAt),
    })
    .returning();

  return mapSession(row);
}

export async function getReaderSession(
  sessionId: string
): Promise<ReaderSession | null> {
  const rows = await db
    .select()
    .from(readerSessions)
    .where(eq(readerSessions.id, sessionId))
    .limit(1);

  const row = rows[0];

  return row ? mapSession(row) : null;
}

export async function updateReaderSession(
  input: UpdateReaderSessionInput
): Promise<ReaderSession | null> {
  const parsed = updateSessionSchema.parse(input);
  const [row] = await db
    .update(readerSessions)
    .set({
      status: parsed.status,
      cursor: parsed.cursor,
      reconSummary: parsed.reconSummary,
      coverageSummary: parsed.coverageSummary,
      lastNoteId: parsed.lastNoteId,
      handoffId: parsed.handoffId,
      finishedAt: toDate(parsed.finishedAt),
      updatedAt: new Date(),
    })
    .where(eq(readerSessions.id, parsed.sessionId))
    .returning();

  return row ? mapSession(row) : null;
}

export async function listReaderNotes(
  sessionId: string
): Promise<ReaderNote[]> {
  const noteRows = await db
    .select()
    .from(readerNotes)
    .where(eq(readerNotes.sessionId, sessionId))
    .orderBy(asc(readerNotes.ordinal), asc(readerNotes.createdAt));

  const coverageRows = await db
    .select()
    .from(readerCoverageRanges)
    .where(
      and(
        eq(readerCoverageRanges.sessionId, sessionId),
        isNull(readerCoverageRanges.handoffId)
      )
    )
    .orderBy(asc(readerCoverageRanges.startLine), asc(readerCoverageRanges.recordedAt));

  const coverageByNoteId = new Map<string, ReaderCoverageRange[]>();

  for (const row of coverageRows) {
    if (!row.noteId) {
      continue;
    }

    const ranges = coverageByNoteId.get(row.noteId) ?? [];
    ranges.push(mapCoverageRange(row));
    coverageByNoteId.set(row.noteId, ranges);
  }

  return noteRows.map((row) => mapNote(row, coverageByNoteId.get(row.id) ?? []));
}

export async function getReaderHandoff(
  sessionId: string
): Promise<ReaderHandoff | null> {
  const rows = await db
    .select()
    .from(readerHandoffs)
    .where(eq(readerHandoffs.sessionId, sessionId))
    .orderBy(desc(readerHandoffs.createdAt))
    .limit(1);

  const row = rows[0];

  return row ? mapHandoff(row) : null;
}

export async function replaceReaderCoverageRanges(
  input: ReplaceReaderCoverageRangesInput
): Promise<ReaderCoverageRange[]> {
  const parsed = replaceCoverageSchema.parse(input);

  for (const range of parsed.ranges) {
    if (range.sessionId !== parsed.sessionId) {
      throw new Error("Coverage range sessionId must match the replacement scope");
    }

    if ((range.noteId ?? null) !== (parsed.noteId ?? null)) {
      throw new Error("Coverage range noteId must match the replacement scope");
    }

    if ((range.handoffId ?? null) !== (parsed.handoffId ?? null)) {
      throw new Error(
        "Coverage range handoffId must match the replacement scope"
      );
    }
  }

  return db.transaction(async (tx) => {
    await tx
      .delete(readerCoverageRanges)
      .where(
        and(
          eq(readerCoverageRanges.sessionId, parsed.sessionId),
          parsed.noteId
            ? eq(readerCoverageRanges.noteId, parsed.noteId)
            : isNull(readerCoverageRanges.noteId),
          parsed.handoffId
            ? eq(readerCoverageRanges.handoffId, parsed.handoffId)
            : isNull(readerCoverageRanges.handoffId)
        )
      );

    if (parsed.ranges.length === 0) {
      await tx
        .update(readerSessions)
        .set({ updatedAt: new Date() })
        .where(eq(readerSessions.id, parsed.sessionId));

      return [];
    }

    const insertedRows = await tx
      .insert(readerCoverageRanges)
      .values(
        parsed.ranges.map((range) => ({
          sessionId: parsed.sessionId,
          noteId: parsed.noteId ?? null,
          handoffId: parsed.handoffId ?? null,
          ...serializeSource(range.source),
          startLine: range.startLine,
          endLine: range.endLine,
          startOffset: range.startOffset,
          endOffset: range.endOffset,
          disposition: range.disposition,
          reason: range.reason,
          toolName: range.toolName,
          recordedAt: toDate(range.recordedAt) ?? new Date(),
        }))
      )
      .returning();

    await tx
      .update(readerSessions)
      .set({ updatedAt: new Date() })
      .where(eq(readerSessions.id, parsed.sessionId));

    return insertedRows.map(mapCoverageRange);
  });
}

export async function saveReaderNote(
  input: SaveReaderNoteInput
): Promise<ReaderNote> {
  const parsed = saveNoteSchema.parse(input);

  return db.transaction(async (tx) => {
    const [row] = parsed.id
      ? await tx
          .update(readerNotes)
          .set({
            status: parsed.status,
            ordinal: parsed.ordinal,
            summary: parsed.summary,
            facts: parsed.facts,
            inferences: parsed.inferences,
            unresolvedQuestions: parsed.unresolvedQuestions,
            followUpActions: parsed.followUpActions,
            evidence: parsed.evidence,
            checkpoint: parsed.checkpoint,
            updatedAt: toDate(parsed.updatedAt) ?? new Date(),
          })
          .where(
            and(
              eq(readerNotes.id, parsed.id),
              eq(readerNotes.sessionId, parsed.sessionId)
            )
          )
          .returning()
      : await tx
          .insert(readerNotes)
          .values({
            sessionId: parsed.sessionId,
            status: parsed.status,
            ordinal: parsed.ordinal,
            summary: parsed.summary,
            facts: parsed.facts,
            inferences: parsed.inferences,
            unresolvedQuestions: parsed.unresolvedQuestions,
            followUpActions: parsed.followUpActions,
            evidence: parsed.evidence,
            checkpoint: parsed.checkpoint,
            createdAt: toDate(parsed.createdAt) ?? new Date(),
            updatedAt: toDate(parsed.updatedAt) ?? new Date(),
          })
          .returning();

    if (!row) {
      throw new Error("Reader note does not belong to the provided session");
    }

    await tx
      .delete(readerCoverageRanges)
      .where(
        and(
          eq(readerCoverageRanges.sessionId, parsed.sessionId),
          eq(readerCoverageRanges.noteId, row.id),
          isNull(readerCoverageRanges.handoffId)
        )
      );

    const coverageRows =
      parsed.coverage.length === 0
        ? []
        : await tx
            .insert(readerCoverageRanges)
            .values(
              parsed.coverage.map((range) => ({
                sessionId: parsed.sessionId,
                noteId: row.id,
                handoffId: null,
                ...serializeSource(range.source),
                startLine: range.startLine,
                endLine: range.endLine,
                startOffset: range.startOffset,
                endOffset: range.endOffset,
                disposition: range.disposition,
                reason: range.reason,
                toolName: range.toolName,
                recordedAt: toDate(range.recordedAt) ?? new Date(),
              }))
            )
            .returning();

    await tx
      .update(readerSessions)
      .set({ lastNoteId: row.id, updatedAt: new Date() })
      .where(eq(readerSessions.id, parsed.sessionId));

    return mapNote(row, coverageRows.map(mapCoverageRange));
  });
}

export async function saveReaderHandoff(
  input: SaveReaderHandoffInput
): Promise<ReaderHandoff> {
  const parsed = saveHandoffSchema.parse(input);

  return db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(readerHandoffs)
      .where(eq(readerHandoffs.sessionId, parsed.sessionId))
      .limit(1);

    const existing = parsed.id ? null : existingRows[0];
    const targetId = parsed.id ?? existing?.id;

    const [row] = targetId
      ? await tx
          .update(readerHandoffs)
          .set({
            status: parsed.status,
            executiveSummary: parsed.executiveSummary,
            conclusions: parsed.conclusions,
            gaps: parsed.gaps,
            caveats: parsed.caveats,
            limitations: parsed.limitations,
            nextQuestions: parsed.nextQuestions,
            evidence: parsed.evidence,
            coverageSummary: parsed.coverageSummary,
          })
          .where(
            and(
              eq(readerHandoffs.id, targetId),
              eq(readerHandoffs.sessionId, parsed.sessionId)
            )
          )
          .returning()
      : await tx
          .insert(readerHandoffs)
          .values({
            sessionId: parsed.sessionId,
            status: parsed.status,
            executiveSummary: parsed.executiveSummary,
            conclusions: parsed.conclusions,
            gaps: parsed.gaps,
            caveats: parsed.caveats,
            limitations: parsed.limitations,
            nextQuestions: parsed.nextQuestions,
            evidence: parsed.evidence,
            coverageSummary: parsed.coverageSummary,
            createdAt: toDate(parsed.createdAt) ?? new Date(),
          })
          .returning();

    if (!row) {
      throw new Error("Reader handoff does not belong to the provided session");
    }

    await tx
      .update(readerSessions)
      .set({
        handoffId: row.id,
        coverageSummary: parsed.coverageSummary,
        updatedAt: new Date(),
      })
      .where(eq(readerSessions.id, parsed.sessionId));

    return mapHandoff(row);
  });
}

export async function getReaderSessionArtifacts(sessionId: string): Promise<{
  session: ReaderSession | null;
  notes: ReaderNote[];
  handoff: ReaderHandoff | null;
  coverage: ReaderCoverageRange[];
}> {
  const [session, notes, handoff, coverage] = await Promise.all([
    getReaderSession(sessionId),
    listReaderNotes(sessionId),
    getReaderHandoff(sessionId),
    getCoverageForScope({ sessionId }),
  ]);

  return { session, notes, handoff, coverage };
}

export async function getLatestReaderSessionArtifactsForBook(
  bookId: string
): Promise<{
  session: ReaderSession | null;
  notes: ReaderNote[];
  handoff: ReaderHandoff | null;
  coverage: ReaderCoverageRange[];
}> {
  const rows = await db
    .select({ id: readerSessions.id })
    .from(readerSessions)
    .where(eq(readerSessions.bookId, bookId))
    .orderBy(desc(readerSessions.updatedAt), desc(readerSessions.createdAt))
    .limit(1);

  const sessionId = rows[0]?.id;

  if (!sessionId) {
    return {
      session: null,
      notes: [],
      handoff: null,
      coverage: [],
    };
  }

  return getReaderSessionArtifacts(sessionId);
}