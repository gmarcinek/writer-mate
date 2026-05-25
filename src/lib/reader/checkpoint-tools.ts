import "server-only";

import { z } from "zod";
import {
  getReaderHandoff,
  getReaderSession,
  listReaderNotes,
  saveReaderNote,
  updateReaderSession,
} from "@/lib/reader/persistence";
import {
  ReaderCoverageDisposition,
  ReaderEvidenceKind,
  ReaderHandoffStatus,
  ReaderNoteStatus,
  ReaderSessionStatus,
  ReaderSourceType,
  ReaderStatementKind,
  type ReaderEvidenceMetadata,
  type ReaderLineRange,
} from "@/lib/reader/types";

type TimestampInput = Date | string;

const lineRangeShape = {
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
};

const lineRangeObjectSchema = z.object(lineRangeShape);

const lineRangeSchema = z
  .object(lineRangeShape)
  .refine((value) => value.startLine <= value.endLine, {
    message: "startLine must be <= endLine",
  });

const rangeRefSchema = lineRangeObjectSchema.extend({
  startOffset: z.number().int().min(0).optional(),
  endOffset: z.number().int().min(0).optional(),
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

const saveNotesSchema = z.object({
  sessionId: z.string().uuid(),
  noteId: z.string().uuid().optional(),
  status: z.nativeEnum(ReaderNoteStatus),
  ordinal: z.number().int().min(0),
  summary: z.string().min(1),
  facts: z.array(z.string()),
  inferences: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  followUpActions: z.array(z.string()),
  evidence: z.array(evidenceSchema),
  savedAt: z.union([z.date(), z.string().datetime()]).optional(),
});

const finishSchema = z.object({
  sessionId: z.string().uuid(),
  cursor: lineRangeSchema.nullable().optional(),
  savedAt: z.union([z.date(), z.string().datetime()]).optional(),
});

export type SaveNotesInput = z.input<typeof saveNotesSchema>;
export type SaveNotesResult = {
  sessionId: string;
  noteId: string;
  savedAt: string;
};

export type FinishInput = z.input<typeof finishSchema>;
export type FinishResult = {
  sessionId: string;
  status: "complete" | "partial";
  handoffId: string;
  savedAt: string;
  uncoveredRanges: ReaderLineRange[];
};

function toDate(value?: TimestampInput): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value instanceof Date ? value : new Date(value);
}

function toSessionStatus(status: ReaderHandoffStatus) {
  return status === ReaderHandoffStatus.Complete
    ? ReaderSessionStatus.Complete
    : ReaderSessionStatus.Partial;
}

export async function saveNotes(input: SaveNotesInput): Promise<SaveNotesResult> {
  const parsed = saveNotesSchema.parse(input);
  const session = await getReaderSession(parsed.sessionId);

  if (!session) {
    throw new Error("Reader session was not found for saveNotes");
  }

  const note = await saveReaderNote({
    id: parsed.noteId,
    sessionId: parsed.sessionId,
    status: parsed.status,
    ordinal: parsed.ordinal,
    summary: parsed.summary,
    facts: parsed.facts,
    inferences: parsed.inferences,
    unresolvedQuestions: parsed.unresolvedQuestions,
    followUpActions: parsed.followUpActions,
    evidence: parsed.evidence as ReaderEvidenceMetadata[],
    coverage: [],
    createdAt: toDate(parsed.savedAt),
    updatedAt: toDate(parsed.savedAt),
  });

  return {
    sessionId: parsed.sessionId,
    noteId: note.id,
    savedAt: note.updatedAt,
  };
}

export async function finish(input: FinishInput): Promise<FinishResult> {
  const parsed = finishSchema.parse(input);
  const [session, notes, handoff] = await Promise.all([
    getReaderSession(parsed.sessionId),
    listReaderNotes(parsed.sessionId),
    getReaderHandoff(parsed.sessionId),
  ]);

  if (!session) {
    throw new Error("Reader session was not found for finish");
  }

  if (!handoff) {
    throw new Error("Reader finish requires a persisted handoff");
  }

  const lastNote = session.lastNoteId
    ? notes.find((note) => note.id === session.lastNoteId)
    : notes.at(-1);

  if (!lastNote) {
    throw new Error("Reader finish requires at least one persisted note");
  }

  const terminalState = await updateReaderSession({
    sessionId: parsed.sessionId,
    status: toSessionStatus(handoff.status),
    cursor: parsed.cursor === undefined ? session.cursor ?? undefined : parsed.cursor,
    coverageSummary: handoff.coverageSummary,
    lastNoteId: lastNote.id,
    handoffId: handoff.id,
    finishedAt: toDate(parsed.savedAt) ?? new Date(),
  });

  if (!terminalState?.finishedAt) {
    throw new Error("Reader finish could not persist terminal session state");
  }

  return {
    sessionId: terminalState.id,
    status: handoff.status,
    handoffId: handoff.id,
    savedAt: terminalState.finishedAt,
    uncoveredRanges: handoff.coverageSummary.gapRanges,
  };
}

export const readerCheckpointTools = {
  saveNotes,
  finish,
};