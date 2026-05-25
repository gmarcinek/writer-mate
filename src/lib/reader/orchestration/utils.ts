import "server-only";

import { z } from "zod";
import { MAX_READ_LINES, readerSourceAdapter } from "@/lib/reader/source-adapter";
import { getReaderSessionArtifacts } from "@/lib/reader/persistence";
import {
  ReaderCoverageDisposition,
  ReaderSessionStatus,
  type ReaderCoverageRange,
  type ReaderCoverageSummary,
  type ReaderEvidenceMetadata,
  type ReaderLineRange,
  type ReaderNote,
  type ReaderSourceRef,
} from "@/lib/reader/types";
import { DEFAULT_SEARCH_CONTEXT_LINES, DEFAULT_SEARCH_MAX_HITS } from "./schemas";

export function isTerminalStatus(status: ReaderSessionStatus) {
  return (
    status === ReaderSessionStatus.Complete ||
    status === ReaderSessionStatus.Partial ||
    status === ReaderSessionStatus.Failed
  );
}

export function toJsonText(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function parseLooseJson(text: string) {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    // Attempt to repair truncated JSON (model hit maxTokens mid-output)
    return JSON.parse(repairTruncatedJson(withoutFence));
  }
}

/**
 * State-machine repair for JSON truncated at an arbitrary position.
 * Handles: unclosed strings, trailing commas, unclosed arrays/objects.
 */
function repairTruncatedJson(raw: string): string {
  const stack: Array<"{" | "["> = [];
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (inString) {
      if (ch === "\\") {
        escaped = true;
        result += ch;
      } else if (ch === '"') {
        inString = false;
        result += ch;
      } else {
        result += ch;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      result += ch;
    } else if (ch === "{") {
      stack.push("{");
      result += ch;
    } else if (ch === "[") {
      stack.push("[");
      result += ch;
    } else if (ch === "}") {
      if (stack.at(-1) === "{") stack.pop();
      result += ch;
    } else if (ch === "]") {
      if (stack.at(-1) === "[") stack.pop();
      result += ch;
    } else {
      result += ch;
    }
  }

  // Close any unclosed string
  if (inString) result += '"';

  // Remove trailing comma before we close containers
  const withoutTrailingComma = result.trimEnd().replace(/,\s*$/, "");

  // Close remaining containers in reverse order
  let closed = withoutTrailingComma;
  for (let i = stack.length - 1; i >= 0; i--) {
    closed += stack[i] === "{" ? "}" : "]";
  }

  return closed;
}

export function stripNulls<T>(value: T): T {
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

export function isUuid(value: string | null | undefined) {
  return typeof value === "string" && z.string().uuid().safeParse(value).success;
}

export function persistableCursor(range?: ReaderLineRange | null) {
  if (!range) return undefined;
  return { startLine: range.startLine, endLine: range.endLine };
}

export function getCursorFromReadResult(result: {
  startLine: number;
  endLine: number;
}): ReaderLineRange {
  return { startLine: result.startLine, endLine: result.endLine };
}

export function getCursorFromSkipResult(result: {
  fromLine: number;
  toLine: number;
}): ReaderLineRange {
  return { startLine: result.fromLine, endLine: result.toLine };
}

export function summarizeCoverageLedger(
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
    if (state === 3) readLinesCount += 1;
    else if (state === 2) sampledLinesCount += 1;
    else if (state === 1) skippedLinesCount += 1;
    else if (gapStart === null) gapStart = line;
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

export function normalizeEvidence(notes: ReaderNote[]) {
  const evidence: ReaderEvidenceMetadata[] = [];
  for (const note of notes) {
    note.evidence.forEach((item) => {
      evidence.push({
        ...item,
        id: item.id ?? crypto.randomUUID(),
      });
    });
  }
  return evidence;
}

export function buildCoverageDigest(summary: ReaderCoverageSummary) {
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

export function buildNotesDigest(notes: ReaderNote[]) {
  return notes
    .map((note) =>
      toJsonText({
        noteId: note.id,
        ordinal: note.ordinal,
        status: note.status,
        summary: note.summary,
        facts: note.facts,
        inferences: note.inferences,
        unresolvedQuestions: note.unresolvedQuestions,
        followUpActions: note.followUpActions,
        evidence: note.evidence.map((item, index) => ({
          id: item.id ?? `${note.id}:e${index + 1}`,
          kind: item.kind,
          statementKind: item.statementKind,
          range: item.range,
          quote: item.quote,
          note: item.note,
          confidence: item.confidence,
        })),
      })
    )
    .join("\n\n");
}

export async function searchSourcePhrases(args: {
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
      if (!line.toLocaleLowerCase().includes(queryLower)) continue;
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
      if (hits.length >= maxHits) break;
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

export async function findUnvisitedRanges(args: {
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
