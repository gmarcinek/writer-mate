import "server-only";

import {
  MAX_READ_LINES,
  MAX_READ_SLICE_CHARACTERS,
  readerSourceAdapter,
  type ReaderSourceReadResult,
} from "@/lib/reader/source-adapter";
import {
  type ReaderLineRange,
  type ReaderSession,
  type ReaderSourceRef,
} from "@/lib/reader/types";

const DEFAULT_JUMP_WINDOW_LINES = 40;

type ReaderNavigationSessionContext = Pick<
  ReaderSession,
  "id" | "source" | "cursor"
>;

type ReaderNavigationTargetInput = {
  source?: ReaderSourceRef;
  session?: ReaderNavigationSessionContext;
};

type ReaderResolvedNavigationTarget = {
  source: ReaderSourceRef;
  sessionId?: string;
  cursor?: ReaderLineRange;
};

export interface ReaderToolCounters {
  lineCount: number;
  charCount: number;
  totalLines: number;
  totalCharacters: number;
  remainingLinesBefore: number;
  remainingLinesAfter: number;
  remainingCharactersBefore?: number;
  remainingCharactersAfter?: number;
}

export interface ReaderToolCursor {
  sessionId?: string;
  sourceId: string;
  currentLine: number;
  lastLine: number;
  nextLine: number;
  currentOffset?: number;
  lastOffset?: number;
  nextOffset?: number;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}

export interface ReaderToolLineRangeMetadata {
  startLine: number;
  endLine: number;
  lineCount: number;
}

export interface ReaderToolSliceRangeMetadata
  extends ReaderToolLineRangeMetadata {
  startOffset: number;
  endOffset: number;
  charCount: number;
}

interface ReaderToolResultBase {
  sourceId: string;
  source: ReaderSourceRef;
  title: string;
  totalLines: number;
  totalCharacters: number;
  counters: ReaderToolCounters;
  cursor: ReaderToolCursor;
}

export interface ReaderReadLinesInput extends ReaderNavigationTargetInput {
  startLine: number;
  endLine: number;
}

export interface ReaderReadLinesResult extends ReaderToolResultBase {
  toolName: "readLines";
  requestedRange: ReaderLineRange;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  text: string;
  charCount: number;
  range: ReaderToolSliceRangeMetadata;
}

export interface ReaderJumpToLineInput extends ReaderNavigationTargetInput {
  requestedLine: number;
  windowLines?: number;
  placement?: "start" | "center";
}

export interface ReaderJumpToLineResult extends ReaderToolResultBase {
  toolName: "jumpToLine";
  requestedLine: number;
  requestedWindowLines: number;
  placement: "start" | "center";
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  text: string;
  charCount: number;
  range: ReaderToolSliceRangeMetadata;
}

export interface ReaderSkipLinesInput extends ReaderNavigationTargetInput {
  count: number;
  fromLine?: number;
}

export interface ReaderSkipLinesResult extends ReaderToolResultBase {
  toolName: "skipLines";
  requestedCount: number;
  requestedFromLine?: number;
  fromLine: number;
  toLine: number;
  skippedCount: number;
  range: ReaderToolLineRangeMetadata;
}

export interface ReaderInspectSliceInput extends ReaderNavigationTargetInput {
  startOffset: number;
  endOffset: number;
}

export interface ReaderInspectSliceResult extends ReaderToolResultBase {
  toolName: "inspectSlice";
  requestedOffsets: {
    startOffset: number;
    endOffset: number;
  };
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  text: string;
  charCount: number;
  range: ReaderToolSliceRangeMetadata;
}

function toSafeInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.trunc(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getContinuationLine(line: number, totalLines: number) {
  return clamp(line + 1, 1, totalLines + 1);
}

function sameNullable(a?: string | null, b?: string | null) {
  return (a ?? null) === (b ?? null);
}

function sameSourceRef(a: ReaderSourceRef, b: ReaderSourceRef) {
  return (
    a.sourceType === b.sourceType &&
    a.sourceId === b.sourceId &&
    sameNullable(a.bookId, b.bookId) &&
    sameNullable(a.documentId, b.documentId) &&
    sameNullable(a.chunkId, b.chunkId)
  );
}

function resolveNavigationTarget(
  input: ReaderNavigationTargetInput
): ReaderResolvedNavigationTarget {
  const source = input.session?.source ?? input.source;

  if (!source) {
    throw new Error("Reader navigation requires a source or session context.");
  }

  if (input.session?.source && input.source && !sameSourceRef(input.session.source, input.source)) {
    throw new Error("Reader navigation source does not match session source.");
  }

  return {
    source,
    sessionId: input.session?.id,
    cursor: input.session?.cursor ?? undefined,
  };
}

function buildCounters(result: ReaderSourceReadResult): ReaderToolCounters {
  return {
    lineCount: result.endLine - result.startLine + 1,
    charCount: result.charCount,
    totalLines: result.totalLines,
    totalCharacters: result.totalCharacters,
    remainingLinesBefore: result.startLine - 1,
    remainingLinesAfter: Math.max(0, result.totalLines - result.endLine),
    remainingCharactersBefore: result.startOffset,
    remainingCharactersAfter: Math.max(0, result.totalCharacters - result.endOffset),
  };
}

function buildReadCursor(
  result: ReaderSourceReadResult,
  sessionId: string | undefined,
  fullyConsumesLastLine: boolean
): ReaderToolCursor {
  const hasMoreBefore = result.startLine > 1 || result.startOffset > 0;
  const hasMoreAfter = result.endOffset < result.totalCharacters;
  const nextLine = fullyConsumesLastLine
    ? getContinuationLine(result.endLine, result.totalLines)
    : result.endLine;

  return {
    sessionId,
    sourceId: result.source.sourceId,
    currentLine: result.startLine,
    lastLine: result.endLine,
    nextLine,
    currentOffset: result.startOffset,
    lastOffset: result.endOffset,
    nextOffset: result.endOffset,
    hasMoreBefore,
    hasMoreAfter,
  };
}

function buildSkipCursor(args: {
  sourceId: string;
  sessionId?: string;
  fromLine: number;
  toLine: number;
  skippedCount: number;
  totalLines: number;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}): ReaderToolCursor {
  const nextLine = args.skippedCount > 0
    ? getContinuationLine(args.toLine, args.totalLines)
    : args.fromLine;
  const lastLine = args.skippedCount > 0 ? args.toLine : args.fromLine;

  return {
    sessionId: args.sessionId,
    sourceId: args.sourceId,
    currentLine: args.fromLine,
    lastLine,
    nextLine,
    hasMoreBefore: args.hasMoreBefore,
    hasMoreAfter: args.hasMoreAfter,
  };
}

export async function readLines(
  input: ReaderReadLinesInput
): Promise<ReaderReadLinesResult> {
  const target = resolveNavigationTarget(input);
  const requestedStartLine = toSafeInteger(input.startLine, 1);
  const requestedEndLine = toSafeInteger(input.endLine, requestedStartLine);
  const normalizedStartLine = Math.min(requestedStartLine, requestedEndLine);
  const normalizedEndLine = Math.max(requestedStartLine, requestedEndLine);
  const result = await readerSourceAdapter.readLines(
    target.source,
    normalizedStartLine,
    normalizedEndLine
  );

  return {
    toolName: "readLines",
    sourceId: result.source.sourceId,
    source: result.source,
    title: result.title,
    requestedRange: {
      startLine: normalizedStartLine,
      endLine: normalizedEndLine,
    },
    startLine: result.startLine,
    endLine: result.endLine,
    totalLines: result.totalLines,
    totalCharacters: result.totalCharacters,
    startOffset: result.startOffset,
    endOffset: result.endOffset,
    text: result.text,
    charCount: result.charCount,
    range: {
      startLine: result.startLine,
      endLine: result.endLine,
      lineCount: result.endLine - result.startLine + 1,
      startOffset: result.startOffset,
      endOffset: result.endOffset,
      charCount: result.charCount,
    },
    counters: buildCounters(result),
    cursor: buildReadCursor(result, target.sessionId, true),
  };
}

export async function jumpToLine(
  input: ReaderJumpToLineInput
): Promise<ReaderJumpToLineResult> {
  const target = resolveNavigationTarget(input);
  const metadata = await readerSourceAdapter.getMetadata(target.source);
  const requestedLine = clamp(
    toSafeInteger(input.requestedLine, 1),
    1,
    metadata.totalLines
  );
  const requestedWindowLines = clamp(
    toSafeInteger(input.windowLines ?? DEFAULT_JUMP_WINDOW_LINES, DEFAULT_JUMP_WINDOW_LINES),
    1,
    MAX_READ_LINES
  );
  const placement = input.placement === "center" ? "center" : "start";
  const halfWindow = Math.floor(requestedWindowLines / 2);
  const maxWindowStart = Math.max(1, metadata.totalLines - requestedWindowLines + 1);
  const initialStartLine =
    placement === "center" ? requestedLine - halfWindow : requestedLine;
  const startLine = clamp(
    initialStartLine,
    1,
    placement === "center" ? maxWindowStart : metadata.totalLines
  );
  const endLine = clamp(startLine + requestedWindowLines - 1, 1, metadata.totalLines);
  const result = await readerSourceAdapter.readLines(target.source, startLine, endLine);

  return {
    toolName: "jumpToLine",
    sourceId: result.source.sourceId,
    source: result.source,
    title: result.title,
    requestedLine,
    requestedWindowLines,
    placement,
    startLine: result.startLine,
    endLine: result.endLine,
    totalLines: result.totalLines,
    totalCharacters: result.totalCharacters,
    startOffset: result.startOffset,
    endOffset: result.endOffset,
    text: result.text,
    charCount: result.charCount,
    range: {
      startLine: result.startLine,
      endLine: result.endLine,
      lineCount: result.endLine - result.startLine + 1,
      startOffset: result.startOffset,
      endOffset: result.endOffset,
      charCount: result.charCount,
    },
    counters: buildCounters(result),
    cursor: buildReadCursor(result, target.sessionId, true),
  };
}

export async function skipLines(
  input: ReaderSkipLinesInput
): Promise<ReaderSkipLinesResult> {
  const target = resolveNavigationTarget(input);
  const metadata = await readerSourceAdapter.getMetadata(target.source);
  const requestedCount = Math.max(0, toSafeInteger(input.count, 0));
  const defaultFromLine = target.cursor?.endLine
    ? getContinuationLine(target.cursor.endLine, metadata.totalLines)
    : 1;
  const fromLine = clamp(
    toSafeInteger(input.fromLine ?? defaultFromLine, defaultFromLine),
    1,
    metadata.totalLines + 1
  );
  const skippedCount = Math.min(requestedCount, Math.max(0, metadata.totalLines - fromLine + 1));
  const toLine = skippedCount > 0 ? fromLine + skippedCount - 1 : fromLine;
  const hasMoreBefore = fromLine > 1;
  const hasMoreAfter = fromLine <= metadata.totalLines && (skippedCount === 0 || toLine < metadata.totalLines);
  const remainingLinesAfter = skippedCount > 0
    ? Math.max(0, metadata.totalLines - toLine)
    : Math.max(0, metadata.totalLines - fromLine + 1);

  return {
    toolName: "skipLines",
    sourceId: metadata.source.sourceId,
    source: metadata.source,
    title: metadata.title,
    requestedCount,
    requestedFromLine: input.fromLine,
    fromLine,
    toLine,
    skippedCount,
    totalLines: metadata.totalLines,
    totalCharacters: metadata.totalCharacters,
    range: {
      startLine: fromLine,
      endLine: toLine,
      lineCount: skippedCount,
    },
    counters: {
      lineCount: skippedCount,
      charCount: 0,
      totalLines: metadata.totalLines,
      totalCharacters: metadata.totalCharacters,
      remainingLinesBefore: fromLine - 1,
      remainingLinesAfter,
    },
    cursor: buildSkipCursor({
      sourceId: metadata.source.sourceId,
      sessionId: target.sessionId,
      fromLine,
      toLine,
      skippedCount,
      totalLines: metadata.totalLines,
      hasMoreBefore,
      hasMoreAfter,
    }),
  };
}

export async function inspectSlice(
  input: ReaderInspectSliceInput
): Promise<ReaderInspectSliceResult> {
  const target = resolveNavigationTarget(input);
  const requestedStartOffset = toSafeInteger(input.startOffset, 0);
  const requestedEndOffset = toSafeInteger(input.endOffset, requestedStartOffset);
  const normalizedStartOffset = Math.min(requestedStartOffset, requestedEndOffset);
  const normalizedEndOffset = Math.max(requestedStartOffset, requestedEndOffset);
  const boundedEndOffset = Math.min(
    normalizedEndOffset,
    normalizedStartOffset + MAX_READ_SLICE_CHARACTERS
  );
  const result = await readerSourceAdapter.readSlice(
    target.source,
    normalizedStartOffset,
    boundedEndOffset
  );
  const fullyConsumesLastLine =
    result.endOffset >= result.totalCharacters || result.text.endsWith("\n");

  return {
    toolName: "inspectSlice",
    sourceId: result.source.sourceId,
    source: result.source,
    title: result.title,
    requestedOffsets: {
      startOffset: normalizedStartOffset,
      endOffset: normalizedEndOffset,
    },
    startLine: result.startLine,
    endLine: result.endLine,
    totalLines: result.totalLines,
    totalCharacters: result.totalCharacters,
    startOffset: result.startOffset,
    endOffset: result.endOffset,
    text: result.text,
    charCount: result.charCount,
    range: {
      startLine: result.startLine,
      endLine: result.endLine,
      lineCount: result.endLine - result.startLine + 1,
      startOffset: result.startOffset,
      endOffset: result.endOffset,
      charCount: result.charCount,
    },
    counters: buildCounters(result),
    cursor: buildReadCursor(result, target.sessionId, fullyConsumesLastLine),
  };
}

export const readerNavigationTools = {
  readLines,
  jumpToLine,
  skipLines,
  inspectSlice,
};
