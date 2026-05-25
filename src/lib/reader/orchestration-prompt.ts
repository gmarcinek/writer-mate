import {
  ReaderMode,
  type ReaderGoal,
  type ReaderHandoff,
  type ReaderReconBrief,
  type ReaderSession,
} from "@/lib/reader/types";

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
    "Read the source exhaustively. Prefer sequential traversal unless recon strongly indicates a better bounded jump.",
    "Use tools instead of inventing source content.",
    "Persist structured notes with evidence as you progress.",
    "Write all note content (summary, facts, inferences, questions, actions) in the same language as the source text.",
    "When you have finished reading, call finish() to close the session.",
    "Adaptive chunk sizes: start every new session with readLines windows of 100 lines. After each successful read, you may double the window size. Maximum chunk size is 3000 lines per readLines call.",
    "Treat facts as directly supported by evidence. Put uncertainty into inferences, unresolvedQuestions, caveats, or limitations.",
    "Note markers — prefix every entry: facts with [FAKT], inferences with [HIPOTEZA] (speculation, hypothesis) or [INTERPRETACJA] (interpretive/literary reading) as appropriate.",
    "Fragment meta-impression — begin every note summary with a compact one-liner describing the fragment's character, e.g.: 'L102-145: nastrój=melancholijny, klimat=napięty, emocje=7/10, gęstość=wysoka.' Then continue with the substantive summary.",
    "Use searchPhrases for lexical discovery and jumpToGap when you need to revisit persisted unvisited ranges.",
    "For tool calls, include every parameter key required by the schema. When a value is not used, pass null instead of omitting the key.",
    "When calling saveNotes for a new note, set noteId to null.",
    "Keep each saveNotes payload compact.",
    "Use at most: summary under 800 chars, up to 8 facts, 6 inferences, 5 unresolved questions, 5 follow-up actions, and 4 evidence items.",
    "For saveNotes evidence, prefer anchor ranges over long quotations.",
    "Set evidence.quote to null unless a short literal excerpt is essential.",
    "If you include evidence.quote, keep it to a single line, plain text only, with no raw newlines, and keep it short.",
    "Do not paste large source passages into tool arguments.",
    "If the note would be too large, save a smaller interim note now and continue reading.",
    "Do not produce markdown fences or prose outside tool usage.",
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
    "1. Read bounded windows and advance coverage deliberately. Start with 100-line chunks; double the window after each successful read up to a maximum of 3000 lines per call.",
    "2. Save interim notes whenever you complete a meaningful span or section.",
    "3. When you have finished reading everything, call finish() to close the session.",
    "4. Keep saveNotes payloads compact. Prefer evidence ranges plus short factual anchors over long quoted excerpts.",
    "5. If a note grows too large, split it into multiple smaller notes instead of sending one large saveNotes call.",
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
    "Write all handoff content (executiveSummary, conclusions, gaps, caveats, limitations, nextQuestions) in the same language as the source text.",
    "Return strict JSON only. No markdown fences, no commentary.",
    "The JSON must contain: status, executiveSummary, conclusions, gaps, caveats, limitations, nextQuestions.",
    "Each conclusion must contain: title, summary, statementKind, confidence, evidenceIds.",
    "In conclusion summaries, preserve the [FAKT] / [HIPOTEZA] / [INTERPRETACJA] markers when referencing specific claims from the notes.",
    "Choose status='complete' only when the coverage digest shows high visitedPercent and no significant unvisited ranges remain. Otherwise choose 'partial'.",
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

export function buildMasterHandoffSynthesisPrompt(args: {
  sessions: { goal: ReaderGoal; status: string }[];
  handoffs: ReaderHandoff[];
}): string {
  const layersSummary = args.sessions.map((session, index) => {
    const handoff = args.handoffs[index];
    return [
      `=== Layer ${index + 1}: ${session.goal.prompt} ===`,
      `Status: ${session.status}`,
      handoff ? `Executive summary: ${handoff.executiveSummary}` : "No handoff",
      handoff?.conclusions.length
        ? `Conclusions:\n${handoff.conclusions.map((c) => `  - [${c.statementKind}] ${c.title}: ${c.summary}`).join("\n")}`
        : "",
      handoff?.gaps.length ? `Gaps: ${handoff.gaps.join("; ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    "Synthesize a master reader handoff integrating findings from all reading layers.",
    "Write all content in the same language as the source text.",
    "Return strict JSON only. No markdown fences, no commentary.",
    "The JSON must contain: status, executiveSummary, conclusions, gaps, caveats, limitations, nextQuestions.",
    "Each conclusion must contain: title, summary, statementKind, confidence, evidenceIds.",
    "Integrate findings from all layers. Highlight agreements and contradictions between layers where relevant.",
    "Choose status='complete' only if together the layers provide comprehensive coverage. Otherwise choose 'partial'.",
    `Number of reading layers: ${args.sessions.length}`,
    "Reading layers:",
    ...layersSummary,
  ].join("\n\n");
}