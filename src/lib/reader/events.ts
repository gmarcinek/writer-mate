import { z } from "zod";
import {
  ReaderCheckpointKind,
  ReaderCoverageDisposition,
  ReaderCoverageReason,
  ReaderHandoffStatus,
  ReaderNoteStatus,
  ReaderSessionStatus,
  ReaderSourceType,
  type ReaderCoverageSummary,
} from "@/lib/reader/types";

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

const lineRangeBaseSchema = z.object({
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
});

const lineRangeSchema = lineRangeBaseSchema
  .refine((value) => value.startLine <= value.endLine, {
    message: "startLine must be <= endLine",
  });

const coverageRangeSchema = lineRangeBaseSchema.extend({
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

const coverageSummarySchema: z.ZodType<ReaderCoverageSummary> = z.object({
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

const readerSessionEventBaseSchema = z.object({
  type: z.enum([
    "status",
    "tool_call",
    "tool_result",
    "coverage",
    "note_saved",
    "thinking",
    "handoff_ready",
    "error",
    "answer_chunk",
    "intent_recognized",
    "hint_emitted",
  ]),
  sessionId: z.string().uuid(),
  timestamp: z.string().datetime(),
});

const statusEventSchema = readerSessionEventBaseSchema.extend({
  type: z.literal("status"),
  status: z.nativeEnum(ReaderSessionStatus),
  phase: z.enum(["recon", "reading", "synthesis", "finish", "terminal"]),
  message: z.string().min(1),
  startedNewSession: z.boolean().optional(),
});

const toolCallEventSchema = readerSessionEventBaseSchema.extend({
  type: z.literal("tool_call"),
  toolName: z.string().min(1),
  input: z.unknown(),
});

const toolResultEventSchema = readerSessionEventBaseSchema.extend({
  type: z.literal("tool_result"),
  toolName: z.string().min(1),
  ok: z.boolean(),
  result: z.unknown().optional(),
  errorMessage: z.string().optional(),
});

const coverageEventSchema = readerSessionEventBaseSchema.extend({
  type: z.literal("coverage"),
  noteId: z.string().uuid().optional(),
  toolName: z.string().optional(),
  coverage: z.array(coverageRangeSchema).min(1),
});

const noteSavedEventSchema = readerSessionEventBaseSchema.extend({
  type: z.literal("note_saved"),
  noteId: z.string().uuid(),
  ordinal: z.number().int().min(0),
  status: z.nativeEnum(ReaderNoteStatus),
  checkpointKind: z.nativeEnum(ReaderCheckpointKind).optional(),
  coverageRangeCount: z.number().int().min(0),
});

const thinkingEventSchema = readerSessionEventBaseSchema.extend({
  type: z.literal("thinking"),
  stage: z.enum(["recon", "reading", "synthesis", "finish"]),
  message: z.string().min(1),
});

const handoffReadyEventSchema = readerSessionEventBaseSchema.extend({
  type: z.literal("handoff_ready"),
  handoffId: z.string().uuid(),
  status: z.nativeEnum(ReaderHandoffStatus),
  executiveSummary: z.string().min(1),
  coverageSummary: coverageSummarySchema,
});

const errorEventSchema = readerSessionEventBaseSchema.extend({
  type: z.literal("error"),
  stage: z.enum(["recon", "reading", "synthesis", "finish", "unknown"]),
  message: z.string().min(1),
});

const answerChunkEventSchema = readerSessionEventBaseSchema.extend({
  type: z.literal("answer_chunk"),
  text: z.string(),
  done: z.boolean(),
});

const intentRecognizedEventSchema = readerSessionEventBaseSchema.extend({
  type: z.literal("intent_recognized"),
  intentType: z.string(),
  strategicGoal: z.string(),
  intermediateGoals: z.array(z.string()),
  focusAreas: z.array(z.string()),
});

const hintEmittedEventSchema = readerSessionEventBaseSchema.extend({
  type: z.literal("hint_emitted"),
  hintId: z.string().uuid(),
  description: z.string().min(1),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  fragment: z.string(),
  proposedChange: z.string().min(1),
});

export const readerSessionEventSchema = z.discriminatedUnion("type", [
  statusEventSchema,
  toolCallEventSchema,
  toolResultEventSchema,
  coverageEventSchema,
  noteSavedEventSchema,
  thinkingEventSchema,
  handoffReadyEventSchema,
  errorEventSchema,
  answerChunkEventSchema,
  intentRecognizedEventSchema,
  hintEmittedEventSchema,
]);

export type ReaderSessionEvent = z.infer<typeof readerSessionEventSchema>;
export type ReaderSessionEventSink = (
  event: ReaderSessionEvent
) => void | Promise<void>;

export function createReaderSessionEvent<TType extends ReaderSessionEvent["type"]>(
  type: TType,
  sessionId: string,
  payload: Omit<Extract<ReaderSessionEvent, { type: TType }>, "type" | "sessionId" | "timestamp">
): Extract<ReaderSessionEvent, { type: TType }> {
  return readerSessionEventSchema.parse({
    type,
    sessionId,
    timestamp: new Date().toISOString(),
    ...payload,
  }) as Extract<ReaderSessionEvent, { type: TType }>;
}

export function serializeReaderSessionEvent(event: ReaderSessionEvent) {
  const validated = readerSessionEventSchema.parse(event);

  return `event: ${validated.type}\ndata: ${JSON.stringify(validated)}\n\n`;
}