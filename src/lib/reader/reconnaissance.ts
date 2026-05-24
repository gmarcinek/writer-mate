import "server-only";

import {
  MAX_READ_LINES,
  readerSourceAdapter,
} from "@/lib/reader/source-adapter";
import {
  ReaderReconContentType,
  ReaderReconStrategyHint,
  type ReaderReconBrief,
  type ReaderReconClassification,
  type ReaderReconHeading,
  type ReaderReconSample,
  type ReaderReconStats,
  type ReaderReconSummary,
  type ReaderSourceRef,
} from "@/lib/reader/types";

const MAX_RECON_HEADINGS = 40;
const SAMPLE_WINDOW_LINES = 40;
const MAX_SAMPLE_EXCERPT_CHARACTERS = 1_200;
const MAX_BRIEF_LINES = 5;
const TOC_SCAN_LINES = 120;

type ReconScoreMap = Record<ReaderReconContentType, number>;
type ReconWindowSpec = {
  label: string;
  anchorLine: number;
  size?: number;
};

type ReconObservedLine = {
  lineNumber: number;
  text: string;
};

type ReconWindow = {
  label: string;
  startLine: number;
  endLine: number;
  text: string;
  excerpt: string;
  lines: ReconObservedLine[];
};

function roundTo(value: number, precision = 2): number {
  return Number(value.toFixed(precision));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function slugifyHeading(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

  return normalized || "section";
}

function clipExcerpt(value: string): string {
  const normalized = value.trim();

  if (normalized.length <= MAX_SAMPLE_EXCERPT_CHARACTERS) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_SAMPLE_EXCERPT_CHARACTERS - 3).trimEnd()}...`;
}

function normalizeLooseText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isExplicitTocLine(line: string): boolean {
  const normalized = normalizeLooseText(line.trim());

  return /\b(table of contents|contents|spis tresci)\b/.test(normalized);
}

function isNumberedTocEntry(line: string): boolean {
  const trimmed = line.trim();

  if (!trimmed || trimmed.length > 160 || /^[-*+]\s+/.test(trimmed)) {
    return false;
  }

  return /^(?:\d+(?:\.\d+){0,4}[.)]?|[ivxlcdm]+[.)])\s+.+(?:\.{2,}\s*\d+|\s+\d{1,4})$/i.test(
    trimmed
  );
}

function looksLikeHeadingText(text: string): boolean {
  const trimmed = text.trim();

  if (!trimmed || trimmed.length > 120 || /[.!?;:]$/.test(trimmed)) {
    return false;
  }

  const words = trimmed.split(/\s+/);

  if (words.length > 12) {
    return false;
  }

  return (
    /^[A-Z\u00C0-\u017F]/.test(trimmed) ||
    /\b(chapter|section|part|appendix|rozdzial|rozdział|czesc|część|wstep|wstęp|introduction|overview|summary|podsumowanie)\b/i.test(
      trimmed
    )
  );
}

function parseNumberedHeading(line: string): { level: number; text: string } | null {
  const trimmed = line.trim();

  if (!trimmed || isNumberedTocEntry(trimmed)) {
    return null;
  }

  const match = trimmed.match(
    /^((?:\d+\.)+\d*|\d+[.)]|[IVXLCDM]+[.)])\s+(.+)$/
  );

  if (!match) {
    return null;
  }

  const headingText = match[2]?.trim() ?? "";

  if (!looksLikeHeadingText(headingText)) {
    return null;
  }

  const numericPrefix = match[1].replace(/[.)]$/, "");
  const numericDepth = numericPrefix.includes(".")
    ? numericPrefix.split(".").filter(Boolean).length
    : 1;

  return {
    level: clamp(numericDepth, 1, 6),
    text: headingText,
  };
}

function buildStats(lines: string[], text: string): ReaderReconStats {
  const lineLengths = lines.map((line) => line.length);
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0).length;
  const longestLineLength = lineLengths.reduce(
    (longest, current) => Math.max(longest, current),
    0
  );

  return {
    totalLines: lines.length,
    totalCharacters: text.length,
    averageLineLength:
      lines.length > 0
        ? roundTo(lineLengths.reduce((sum, current) => sum + current, 0) / lines.length)
        : 0,
    nonEmptyLines,
    emptyLines: Math.max(0, lines.length - nonEmptyLines),
    longestLineLength,
  };
}

function buildEstimatedStats(
  totalLines: number,
  totalCharacters: number,
  observedLines: string[]
): ReaderReconStats {
  const observedNonEmptyLines = observedLines.filter(
    (line) => line.trim().length > 0
  ).length;
  const observedLineLengths = observedLines.map((line) => line.length);
  const nonEmptyRatio =
    observedLines.length > 0 ? observedNonEmptyLines / observedLines.length : 0;
  const estimatedNonEmptyLines = Math.round(totalLines * nonEmptyRatio);

  return {
    totalLines,
    totalCharacters,
    averageLineLength:
      totalLines > 0 ? roundTo(totalCharacters / totalLines) : 0,
    nonEmptyLines: clamp(estimatedNonEmptyLines, 0, totalLines),
    emptyLines: clamp(totalLines - estimatedNonEmptyLines, 0, totalLines),
    longestLineLength: observedLineLengths.reduce(
      (longest, current) => Math.max(longest, current),
      0
    ),
  };
}

function detectHeadings(lines: string[]): {
  headings: ReaderReconHeading[];
  truncated: boolean;
  headingLines: Set<number>;
} {
  const headings: ReaderReconHeading[] = [];
  const headingLines = new Set<number>();
  let truncated = false;

  const pushHeading = (line: number, level: number, text: string) => {
    if (headings.length >= MAX_RECON_HEADINGS) {
      truncated = true;
      return;
    }

    const normalizedText = text.trim();

    if (!normalizedText) {
      return;
    }

    headings.push({
      line,
      level,
      text: normalizedText,
      slug: slugifyHeading(normalizedText),
    });
    headingLines.add(line);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index] ?? "";
    const atxMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);

    if (atxMatch) {
      pushHeading(lineNumber, atxMatch[1].length, atxMatch[2]);
      continue;
    }

    if (index === 0) {
      continue;
    }

    const setextMatch = line.match(/^\s{0,3}(=+|-+)\s*$/);
    const previousLine = lines[index - 1] ?? "";

    if (!setextMatch || !previousLine.trim()) {
      continue;
    }

    const previousLineNumber = lineNumber - 1;

    if (headingLines.has(previousLineNumber)) {
      continue;
    }

    pushHeading(previousLineNumber, setextMatch[1][0] === "=" ? 1 : 2, previousLine);

    continue;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index] ?? "";

    if (headingLines.has(lineNumber)) {
      continue;
    }

    const numberedHeading = parseNumberedHeading(line);

    if (!numberedHeading) {
      continue;
    }

    const previousLine = lines[index - 1]?.trim() ?? "";
    const nextLine = lines[index + 1]?.trim() ?? "";

    if (previousLine && nextLine && !/^[A-Z\u00C0-\u017F]/.test(numberedHeading.text)) {
      continue;
    }

    pushHeading(lineNumber, numberedHeading.level, numberedHeading.text);
  }

  return { headings, truncated, headingLines };
}

function detectHeadingsInObservedLines(observedLines: ReconObservedLine[]): {
  headings: ReaderReconHeading[];
  truncated: boolean;
} {
  const headings: ReaderReconHeading[] = [];
  const seenHeadingLines = new Set<number>();
  let truncated = false;

  const orderedLineNumbers = observedLines.map((line) => line.lineNumber);
  let currentGroup: ReconObservedLine[] = [];

  const flushGroup = () => {
    if (currentGroup.length === 0) {
      return;
    }

    const groupStartLine = currentGroup[0]?.lineNumber ?? 1;
    const groupLines = currentGroup.map((line) => line.text);
    const detected = detectHeadings(groupLines);

    truncated = truncated || detected.truncated;

    for (const heading of detected.headings) {
      const absoluteLine = groupStartLine + heading.line - 1;

      if (seenHeadingLines.has(absoluteLine) || headings.length >= MAX_RECON_HEADINGS) {
        truncated = true;
        continue;
      }

      headings.push({
        ...heading,
        line: absoluteLine,
      });
      seenHeadingLines.add(absoluteLine);
    }

    currentGroup = [];
  };

  for (let index = 0; index < observedLines.length; index += 1) {
    const currentLine = observedLines[index];
    const previousLineNumber = orderedLineNumbers[index - 1];

    if (
      currentGroup.length > 0 &&
      previousLineNumber !== undefined &&
      currentLine.lineNumber !== previousLineNumber + 1
    ) {
      flushGroup();
    }

    currentGroup.push(currentLine);
  }

  flushGroup();

  return { headings, truncated };
}

function hasNumberedTocPattern(lines: string[]): boolean {
  let consecutiveMatches = 0;

  for (const line of lines) {
    if (isNumberedTocEntry(line)) {
      consecutiveMatches += 1;

      if (consecutiveMatches >= 3) {
        return true;
      }

      continue;
    }

    if (line.trim()) {
      consecutiveMatches = 0;
    }
  }

  return false;
}

function buildStructureHints(
  headings: ReaderReconHeading[],
  truncated: boolean,
  stats: ReaderReconStats,
  lines: string[]
): string[] {
  const hints: string[] = [];
  const maxHeadingDepth = headings.reduce(
    (deepest, heading) => Math.max(deepest, heading.level),
    0
  );
  const topHeadings = headings
    .filter((heading) => heading.level <= 2)
    .slice(0, 4)
    .map((heading) => heading.text);
  const hasExplicitToc = lines.some((line) => isExplicitTocLine(line));
  const hasNumberedToc = hasNumberedTocPattern(lines);

  if (headings.length > 0) {
    hints.push(
      `Detected ${headings.length}${truncated ? "+" : ""} markdown headings with depth up to ${maxHeadingDepth}.`
    );
  } else {
    hints.push("No markdown heading structure detected.");
  }

  if (topHeadings.length > 0) {
    hints.push(`Early section hints: ${topHeadings.join(" | ")}.`);
  }

  if (hasExplicitToc) {
    hints.push("Contains an explicit table-of-contents marker.");
  }

  if (hasNumberedToc) {
    hints.push("Contains a numbered table-of-contents-like pattern.");
  }

  if (stats.emptyLines > stats.nonEmptyLines * 0.35) {
    hints.push("Document is spaced with frequent blank-line separators.");
  }

  return hints.slice(0, MAX_BRIEF_LINES);
}

function getSampleWindow(totalLines: number, anchorLine: number, label: string): {
  label: string;
  startLine: number;
  endLine: number;
} {
  if (totalLines <= 0) {
    return { label, startLine: 1, endLine: 1 };
  }

  if (label === "start") {
    return {
      label,
      startLine: 1,
      endLine: Math.min(totalLines, SAMPLE_WINDOW_LINES),
    };
  }

  if (label === "end") {
    return {
      label,
      startLine: Math.max(1, totalLines - SAMPLE_WINDOW_LINES + 1),
      endLine: totalLines,
    };
  }

  const halfWindow = Math.floor(SAMPLE_WINDOW_LINES / 2);
  const startLine = clamp(
    anchorLine - halfWindow,
    1,
    Math.max(1, totalLines - SAMPLE_WINDOW_LINES + 1)
  );
  const endLine = Math.min(totalLines, startLine + SAMPLE_WINDOW_LINES - 1);

  return { label, startLine, endLine };
}

function getBoundedWindow(
  totalLines: number,
  anchorLine: number,
  label: string,
  windowSize: number
): {
  label: string;
  startLine: number;
  endLine: number;
} {
  if (windowSize === SAMPLE_WINDOW_LINES) {
    return getSampleWindow(totalLines, anchorLine, label);
  }

  if (totalLines <= 0) {
    return { label, startLine: 1, endLine: 1 };
  }

  if (label === "start") {
    return {
      label,
      startLine: 1,
      endLine: Math.min(totalLines, windowSize),
    };
  }

  if (label === "end") {
    return {
      label,
      startLine: Math.max(1, totalLines - windowSize + 1),
      endLine: totalLines,
    };
  }

  const halfWindow = Math.floor(windowSize / 2);
  const startLine = clamp(
    anchorLine - halfWindow,
    1,
    Math.max(1, totalLines - windowSize + 1)
  );
  const endLine = Math.min(totalLines, startLine + windowSize - 1);

  return { label, startLine, endLine };
}

function getSampleSpecs(totalLines: number): ReconWindowSpec[] {
  return [
    { label: "start", anchorLine: 1 },
    { label: "first-third", anchorLine: Math.ceil(totalLines / 3) },
    { label: "second-third", anchorLine: Math.ceil((totalLines * 2) / 3) },
    { label: "end", anchorLine: totalLines },
  ];
}

function mapWindowLines(
  startLine: number,
  endLine: number,
  text: string
): ReconObservedLine[] {
  const splitLines = text.split("\n");

  if (text.endsWith("\n") && splitLines[splitLines.length - 1] === "") {
    splitLines.pop();
  }

  return splitLines
    .slice(0, Math.max(0, endLine - startLine + 1))
    .map((line, index) => ({
    lineNumber: startLine + index,
    text: line,
  }));
}

async function readReconWindows(
  source: ReaderSourceRef,
  totalLines: number,
  specs: ReconWindowSpec[]
): Promise<ReconWindow[]> {
  const seenRanges = new Set<string>();
  const windows = specs
    .map((spec) =>
      getBoundedWindow(
        totalLines,
        spec.anchorLine,
        spec.label,
        Math.min(spec.size ?? SAMPLE_WINDOW_LINES, MAX_READ_LINES)
      )
    )
    .filter((window) => {
      const key = `${window.startLine}:${window.endLine}`;

      if (seenRanges.has(key)) {
        return false;
      }

      seenRanges.add(key);
      return true;
    });

  const reads = await Promise.all(
    windows.map((window) =>
      readerSourceAdapter.readLines(source, window.startLine, window.endLine)
    )
  );

  return reads.map((readResult, index) => ({
    label: windows[index]?.label ?? "sample",
    startLine: readResult.startLine,
    endLine: readResult.endLine,
    text: readResult.text,
    excerpt: clipExcerpt(readResult.text),
    lines: mapWindowLines(
      readResult.startLine,
      readResult.endLine,
      readResult.text
    ),
  }));
}

function buildSamplesFromWindows(windows: ReconWindow[]): ReaderReconSample[] {
  const samples: ReaderReconSample[] = [];

  for (const window of windows) {
    samples.push({
      label: window.label,
      startLine: window.startLine,
      endLine: window.endLine,
      excerpt: window.excerpt,
      charCount: window.excerpt.length,
    });
  }

  return samples;
}

function dedupeObservedLines(windows: ReconWindow[]): ReconObservedLine[] {
  const observedLines = new Map<number, string>();

  for (const window of windows) {
    for (const line of window.lines) {
      if (!observedLines.has(line.lineNumber)) {
        observedLines.set(line.lineNumber, line.text);
      }
    }
  }

  return Array.from(observedLines.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([lineNumber, text]) => ({ lineNumber, text }));
}

function buildContentScores(lines: string[], headings: ReaderReconHeading[]): {
  scores: ReconScoreMap;
  signals: string[];
} {
  let insideCodeFence = false;
  let bulletLines = 0;
  let numberedListLines = 0;
  let tableLines = 0;
  let recordLines = 0;
  let logLines = 0;
  let legalLines = 0;
  let technicalLines = 0;
  let narrativeLines = 0;
  let codeFenceLines = 0;
  let codeLikeLines = 0;
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0).length || 1;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (/^(```|~~~)/.test(trimmed)) {
      insideCodeFence = !insideCodeFence;
      codeFenceLines += 1;
      continue;
    }

    if (insideCodeFence) {
      codeLikeLines += 1;
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      bulletLines += 1;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      numberedListLines += 1;
    }

    if (/^\|.*\|\s*$/.test(trimmed) || /^[:\-\s|]+\|[:\-\s|]+$/.test(trimmed)) {
      tableLines += 1;
    }

    if (/^[^,]+(,[^,]+){2,}$/.test(trimmed) || /^[A-Za-z0-9_.-]+:\s+.+$/.test(trimmed)) {
      recordLines += 1;
    }

    if (
      /^(\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}|\[[A-Z]+\]|INFO\b|WARN\b|ERROR\b|DEBUG\b|TRACE\b)/.test(
        trimmed
      )
    ) {
      logLines += 1;
    }

    if (
      /\b(whereas|hereby|thereof|therein|pursuant|shall|witnesseth|agreement|party|article\s+\d+|section\s+\d+)\b/i.test(
        trimmed
      )
    ) {
      legalLines += 1;
    }

    if (
      /\b(api|http|https|json|yaml|xml|markdown|function|parameter|endpoint|configuration|install|usage|example|requirements?)\b/i.test(
        trimmed
      )
    ) {
      technicalLines += 1;
    }

    if (
      /^(const|let|var|function|class|interface|type|import|export|SELECT\b|FROM\b|if\s*\(|for\s*\(|while\s*\(|return\b|[A-Za-z0-9_.-]+\s*=\s*.+)$/.test(
        trimmed
      )
    ) {
      codeLikeLines += 1;
    }

    if (
      trimmed.split(/\s+/).length >= 8 &&
      /[.!?]$/.test(trimmed) &&
      !/^[-*+]|^\d+[.)]/.test(trimmed)
    ) {
      narrativeLines += 1;
    }
  }

  const headingDensity = headings.length / nonEmptyLines;
  const scores: ReconScoreMap = {
    [ReaderReconContentType.Narrative]: roundTo(
      (narrativeLines * 1.4 + Math.max(0, nonEmptyLines - headings.length - bulletLines - codeLikeLines) * 0.15) /
        nonEmptyLines
    ),
    [ReaderReconContentType.TechnicalDocumentation]: roundTo(
      (technicalLines * 1.8 + headings.length * 1.2 + bulletLines + numberedListLines) /
        nonEmptyLines
    ),
    [ReaderReconContentType.LegalFormal]: roundTo(
      (legalLines * 2.5 + numberedListLines * 0.8 + headingDensity * 8) / nonEmptyLines
    ),
    [ReaderReconContentType.LogsDiagnostics]: roundTo(
      (logLines * 2.5 + recordLines * 0.5) / nonEmptyLines
    ),
    [ReaderReconContentType.TabularRecordLike]: roundTo(
      (tableLines * 2.8 + recordLines * 1.6) / nonEmptyLines
    ),
    [ReaderReconContentType.CodeConfig]: roundTo(
      (codeFenceLines * 2.2 + codeLikeLines * 2.2) / nonEmptyLines
    ),
    [ReaderReconContentType.Mixed]: 0,
  };

  const signals: string[] = [];

  if (headings.length > 0) {
    signals.push(`${headings.length} heading markers`);
  }

  if (technicalLines > 0) {
    signals.push(`${technicalLines} technical-reference lines`);
  }

  if (codeLikeLines + codeFenceLines > 0) {
    signals.push(`${codeLikeLines + codeFenceLines} code/config-like lines`);
  }

  if (legalLines > 0) {
    signals.push(`${legalLines} legal-formal lines`);
  }

  if (logLines > 0) {
    signals.push(`${logLines} log-like lines`);
  }

  if (tableLines + recordLines > 0) {
    signals.push(`${tableLines + recordLines} tabular or record-like lines`);
  }

  if (narrativeLines > 0) {
    signals.push(`${narrativeLines} long prose lines`);
  }

  return { scores, signals: signals.slice(0, 5) };
}

function strategyForType(
  type: ReaderReconContentType
): ReaderReconStrategyHint {
  switch (type) {
    case ReaderReconContentType.Narrative:
      return ReaderReconStrategyHint.SequentialChunks;
    case ReaderReconContentType.TechnicalDocumentation:
      return ReaderReconStrategyHint.TargetedSearch;
    case ReaderReconContentType.LegalFormal:
      return ReaderReconStrategyHint.SectionBySection;
    case ReaderReconContentType.LogsDiagnostics:
      return ReaderReconStrategyHint.ClusteredInvestigation;
    case ReaderReconContentType.TabularRecordLike:
      return ReaderReconStrategyHint.RecordSampling;
    case ReaderReconContentType.CodeConfig:
      return ReaderReconStrategyHint.TargetedSearch;
    case ReaderReconContentType.Mixed:
      return ReaderReconStrategyHint.Hybrid;
  }
}

function classifyContent(
  lines: string[],
  headings: ReaderReconHeading[]
): ReaderReconClassification {
  const { scores, signals } = buildContentScores(lines, headings);
  const ranked = Object.entries(scores)
    .filter(([type]) => type !== ReaderReconContentType.Mixed)
    .sort((left, right) => right[1] - left[1]) as Array<[
    ReaderReconContentType,
    number,
  ]>;
  const [topType, topScore] = ranked[0] ?? [ReaderReconContentType.Mixed, 0];
  const secondScore = ranked[1]?.[1] ?? 0;
  const shouldBeMixed =
    topScore < 0.2 || (secondScore >= 0.18 && secondScore >= topScore * 0.85);
  const primaryType = shouldBeMixed ? ReaderReconContentType.Mixed : topType;
  const secondaryTypes = ranked
    .filter(([type, score]) => type !== primaryType && score >= Math.max(0.18, topScore * 0.5))
    .slice(0, 2)
    .map(([type]) => type);

  return {
    primaryType,
    secondaryTypes,
    suggestedStrategy: strategyForType(primaryType),
    signals,
  };
}

function humanizeReconType(type: ReaderReconContentType): string {
  return type.replace(/_/g, " ");
}

function buildBriefLines(
  stats: ReaderReconStats,
  classification: ReaderReconClassification,
  structureHints: string[],
  samples: ReaderReconSample[]
): string[] {
  const lines = [
    `${stats.totalLines} lines, ${stats.totalCharacters} characters, average line length ${stats.averageLineLength}.`,
    `Primary type: ${humanizeReconType(classification.primaryType)}; suggested strategy: ${classification.suggestedStrategy.replace(/_/g, " ")}.`,
  ];

  if (structureHints[0]) {
    lines.push(structureHints[0]);
  }

  if (classification.signals.length > 0) {
    lines.push(`Signals: ${classification.signals.join(", ")}.`);
  }

  if (samples.length > 0) {
    lines.push(
      `Sample windows: ${samples
        .map((sample) => `${sample.label} ${sample.startLine}-${sample.endLine}`)
        .join("; ")}.`
    );
  }

  return lines.slice(0, MAX_BRIEF_LINES);
}

function buildSummary(
  stats: ReaderReconStats,
  structureHints: string[],
  samples: ReaderReconSample[],
  classification: ReaderReconClassification,
  headings: ReaderReconHeading[]
): ReaderReconSummary {
  return {
    totalLines: stats.totalLines,
    totalCharacters: stats.totalCharacters,
    averageLineLength: stats.averageLineLength,
    structureHints,
    samples: samples.map(({ label, startLine, endLine }) => ({
      label,
      startLine,
      endLine,
    })),
    contentType: classification.primaryType,
    suggestedStrategy: classification.suggestedStrategy,
    headingCount: headings.length,
    maxHeadingDepth: headings.reduce(
      (deepest, heading) => Math.max(deepest, heading.level),
      0
    ),
  };
}

export async function runReaderReconnaissance(
  source: ReaderSourceRef
): Promise<ReaderReconBrief> {
  const metadata = await readerSourceAdapter.getMetadata(source);
  const sampleSpecs = getSampleSpecs(metadata.totalLines);
  const isSmallSource = metadata.totalLines <= MAX_READ_LINES;

  const sampleWindows = isSmallSource
    ? await readReconWindows(source, metadata.totalLines, [
        {
          label: "full",
          anchorLine: 1,
          size: Math.max(1, metadata.totalLines),
        },
      ])
    : await readReconWindows(source, metadata.totalLines, sampleSpecs);
  const analysisWindows = isSmallSource
    ? sampleWindows
    : await readReconWindows(source, metadata.totalLines, [
        ...sampleSpecs,
        {
          label: "toc-scan",
          anchorLine: 1,
          size: TOC_SCAN_LINES,
        },
      ]);
  const observedLines = dedupeObservedLines(analysisWindows);
  const observedTextLines = observedLines.map((line) => line.text);
  const stats = isSmallSource
    ? buildStats(
        sampleWindows[0]?.lines.map((line) => line.text) ?? [],
        sampleWindows[0]?.text ?? ""
      )
    : buildEstimatedStats(
        metadata.totalLines,
        metadata.totalCharacters,
        observedTextLines
      );
  const { headings, truncated } = detectHeadingsInObservedLines(observedLines);
  const structureHints = buildStructureHints(
    headings,
    truncated,
    stats,
    observedTextLines
  );
  const samples = isSmallSource
    ? buildSamplesFromWindows(
        await readReconWindows(source, metadata.totalLines, sampleSpecs)
      )
    : buildSamplesFromWindows(sampleWindows);
  const classification = classifyContent(observedTextLines, headings);
  const summary = buildSummary(
    stats,
    structureHints,
    samples,
    classification,
    headings
  );

  return {
    source: metadata.source,
    title: metadata.title,
    stats,
    structure: {
      headings,
      headingCount: headings.length,
      maxHeadingDepth: summary.maxHeadingDepth ?? 0,
      truncated,
      structureHints,
    },
    samples,
    classification,
    summary,
    briefLines: buildBriefLines(stats, classification, structureHints, samples),
  };
}