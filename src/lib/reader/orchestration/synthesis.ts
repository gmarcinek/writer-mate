import "server-only";

import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import {
  getReaderHandoff,
  listReaderSessionsForBook,
  saveReaderMasterHandoff,
} from "@/lib/reader/persistence";
import {
  buildReaderSynthesisPrompt,
  buildMasterHandoffSynthesisPrompt,
} from "@/lib/reader/orchestration-prompt";
import { ReaderHandoffStatus, ReaderSessionStatus, type ReaderHandoff, type ReaderIntent, type ReaderSession } from "@/lib/reader/types";
import { handoffDraftSchema } from "./schemas";
import { buildCoverageDigest, buildNotesDigest, parseLooseJson } from "./utils";
import type { ReaderNote, ReaderCoverageSummary } from "@/lib/reader/types";
import type { runReaderReconnaissance } from "@/lib/reader/reconnaissance";

export async function synthesizeHandoff(args: {
  session: ReaderSession;
  recon: Awaited<ReturnType<typeof runReaderReconnaissance>>;
  notes: ReaderNote[];
  coverageSummary: ReaderCoverageSummary;
  model: string;
  intent?: ReaderIntent;
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
      intent: args.intent,
    }),
    temperature: 0.1,
    maxTokens: 8_000,
  });

  return {
    draft: handoffDraftSchema.parse(parseLooseJson(synthesis.text)),
    usage: synthesis.usage,
  };
}

export async function synthesizeMasterHandoff(args: {
  sessions: ReaderSession[];
  handoffs: ReaderHandoff[];
  model: string;
}) {
  const synthesis = await generateText({
    model: openai(args.model),
    system: [
      "Return valid JSON only.",
      "Do not wrap the response in markdown fences.",
      "Do not omit required fields.",
    ].join("\n"),
    prompt: buildMasterHandoffSynthesisPrompt({
      sessions: args.sessions.map((s) => ({ goal: s.goal, status: s.status })),
      handoffs: args.handoffs,
    }),
    temperature: 0.2,
    maxTokens: 4_000,
  });

  return {
    draft: handoffDraftSchema.parse(parseLooseJson(synthesis.text)),
  };
}

export async function updateMasterHandoff(bookId: string, model: string) {
  const sessions = await listReaderSessionsForBook(bookId);
  const completeSessions = sessions.filter(
    (s) =>
      (s.status === ReaderSessionStatus.Complete || s.status === ReaderSessionStatus.Partial) &&
      s.handoffId != null
  );

  if (completeSessions.length === 0) return;

  const handoffs = (
    await Promise.all(completeSessions.map((s) => getReaderHandoff(s.id)))
  ).filter((h): h is ReaderHandoff => h !== null);

  if (handoffs.length === 0) return;

  const synthesis = await synthesizeMasterHandoff({
    sessions: completeSessions,
    handoffs,
    model,
  });

  await saveReaderMasterHandoff({
    bookId,
    status: synthesis.draft.status,
    executiveSummary: synthesis.draft.executiveSummary,
    conclusions: synthesis.draft.conclusions.map((c) => ({
      ...c,
      statementKind: c.statementKind,
    })),
    gaps: synthesis.draft.gaps,
    caveats: synthesis.draft.caveats,
    limitations: synthesis.draft.limitations,
    nextQuestions: synthesis.draft.nextQuestions,
    sessionIds: completeSessions.map((s) => s.id),
    sessionCount: completeSessions.length,
  });
}
