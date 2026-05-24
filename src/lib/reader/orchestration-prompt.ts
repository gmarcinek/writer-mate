import {
  ReaderCheckpointKind,
  ReaderMode,
  type ReaderGoal,
  type ReaderReconBrief,
  type ReaderSession,
} from "@/lib/reader/types";

export const READER_SYNTHESIS_READY_SENTINEL = "READER_SYNTHESIS_READY";

function formatGoal(goal: ReaderGoal) {
  const lines = [
    `Mode: ${goal.mode}`,
    `Prompt: ${goal.prompt}`,
  ];

  if (goal.questions?.length) {
    lines.push(`Questions: ${goal.questions.join(" | ")}`);
  }

  if (goal.targetEntities?.length) {
    lines.push(`Target entities: ${goal.targetEntities.join(" | ")}`);
  }

  if (goal.requiredCoverage) {
    lines.push(
      `Required coverage: minimumLineCoveragePercent=${goal.requiredCoverage.minimumLineCoveragePercent ?? "n/a"}, requireEndToEndRead=${goal.requiredCoverage.requireEndToEndRead ?? false}`
    );
  }

  if (goal.stopWhenSatisfied !== undefined) {
    lines.push(`Stop when satisfied: ${goal.stopWhenSatisfied}`);
  }

  return lines.join("\n");
}

function formatRecon(recon: ReaderReconBrief) {
  const headingLines = recon.structure.headings
    .slice(0, 12)
    .map((heading) => `L${heading.line} [h${heading.level}] ${heading.text}`);
  const sampleLines = recon.samples.map(
    (sample) => `${sample.label} L${sample.startLine}-${sample.endLine}: ${sample.excerpt}`
  );

  return [
    `Title: ${recon.title}`,
    `Total lines: ${recon.stats.totalLines}`,
    `Total characters: ${recon.stats.totalCharacters}`,
    `Classification: ${recon.classification.primaryType}`,
    `Suggested strategy: ${recon.classification.suggestedStrategy}`,
    `Structure hints: ${recon.structure.structureHints.join(" | ") || "none"}`,
    `Brief: ${recon.briefLines.join(" | ")}`,
    `Headings:\n${headingLines.join("\n") || "none"}`,
    `Samples:\n${sampleLines.join("\n") || "none"}`,
  ].join("\n");
}

export function buildReaderSystemPrompt() {
  return [
    "You are the server-owned exhaustive reader for writer-mate.",
    "Read the source exhaustively first. Prefer sequential traversal unless recon strongly indicates a better bounded jump.",
    "Use tools instead of inventing source content.",
    "Persist structured notes with evidence and coverage as you progress.",
    "When the reading pass is complete, save a final note with checkpoint.kind='final' and non-empty readRanges, skippedRanges, and remainingGapRanges.",
    `After the final checkpoint is saved, reply with the exact text ${READER_SYNTHESIS_READY_SENTINEL}. Do not call finish until the server explicitly re-prompts you for closure.`,
    "Treat facts as directly supported by evidence. Put uncertainty into inferences, unresolvedQuestions, caveats, or limitations.",
    "If you skip lines, mark them explicitly in coverage and summarize why.",
    "Use searchPhrases for lexical discovery and jumpToGap when you need to revisit persisted unvisited ranges.",
    "For tool calls, include every parameter key required by the schema. When a value is not used, pass null instead of omitting the key.",
    "When calling saveNotes for a new note, set noteId to null. Always include a non-empty coverage array aligned with the evidence ranges.",
    "Do not produce markdown fences or prose outside tool usage unless you are explicitly returning the synthesis-ready sentinel.",
  ].join("\n");
}

export function buildReaderRunPrompt(args: {
  recon: ReaderReconBrief;
  session: ReaderSession;
  existingNoteCount: number;
}) {
  const modeInstruction =
    args.session.goal.mode === ReaderMode.Exhaustive
      ? "This run is exhaustive-first. Reach formal end-of-source coverage before concluding."
      : "This run is goal-directed, but still preserve explicit coverage accounting.";

  const resumeInstruction =
    args.existingNoteCount > 0
      ? `Resume the existing session. ${args.existingNoteCount} notes already exist. Continue from the persisted cursor and avoid duplicating prior notes unless you are superseding them.`
      : "This is a new session. Start from the beginning of the source unless recon suggests an initial bounded jump is needed to orient yourself.";

  return [
    modeInstruction,
    resumeInstruction,
    "Reading goal:",
    formatGoal(args.session.goal),
    "Reconnaissance:",
    formatRecon(args.recon),
    "Operational rules:",
    "1. Read bounded windows and advance coverage deliberately.",
    "2. Save interim notes whenever you complete a meaningful span or section.",
    "3. Before concluding, persist one final note with a final checkpoint.",
    `4. Once that final checkpoint is safely persisted, respond with ${READER_SYNTHESIS_READY_SENTINEL}.`,
  ].join("\n\n");
}

export function buildReaderSynthesisPrompt(args: {
  session: ReaderSession;
  recon: ReaderReconBrief;
  notesDigest: string;
  coverageDigest: string;
}) {
  return [
    "Synthesize a final reader handoff from the persisted notes.",
    "Return strict JSON only. No markdown fences, no commentary.",
    "The JSON must contain: status, executiveSummary, conclusions, gaps, caveats, limitations, nextQuestions.",
    "Each conclusion must contain: title, summary, statementKind, confidence, evidenceIds.",
    "Choose status='complete' only when the persisted checkpoint and coverage support an exhaustive formal end. Otherwise choose 'partial'.",
    "Session goal:",
    formatGoal(args.session.goal),
    "Recon summary:",
    formatRecon(args.recon),
    "Coverage digest:",
    args.coverageDigest,
    "Notes digest:",
    args.notesDigest,
  ].join("\n\n");
}

export function buildReaderFinishPrompt(sessionId: string) {
  return [
    `The server has persisted the final handoff for session ${sessionId}.`,
    "Call the finish tool exactly once to close the session formally.",
    "Do not emit any prose. Do not call any other tool.",
  ].join("\n");
}

export const READER_FINAL_CHECKPOINT_KIND = ReaderCheckpointKind.Final;