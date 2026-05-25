import "server-only";

import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { z } from "zod";
import { parseLooseJson } from "./utils";
import { ReaderIntentType, ReaderMode } from "@/lib/reader/types";
import type { ReaderIntent, ReaderSession } from "@/lib/reader/types";
import type { runReaderReconnaissance } from "@/lib/reader/reconnaissance";

const intentSchema = z.object({
  intentType: z.nativeEnum(ReaderIntentType),
  strategicGoal: z.string().min(1).max(400),
  intermediateGoals: z.array(z.string().max(200)).min(1).max(5),
  focusAreas: z.array(z.string().max(120)).max(8),
  skipHeuristics: z.array(z.string().max(160)).max(6),
  prioritySignals: z.array(z.string().max(160)).max(6),
});

export async function recognizeReaderIntent(args: {
  session: ReaderSession;
  recon: Awaited<ReturnType<typeof runReaderReconnaissance>>;
  model: string;
}): Promise<ReaderIntent> {
  const { session, recon, model } = args;
  const { goal } = session;

  const goalLines = [
    `Cel: ${goal.prompt}`,
    goal.questions?.length ? `Pytania: ${goal.questions.join(" | ")}` : "",
    goal.targetEntities?.length ? `Encje docelowe: ${goal.targetEntities.join(", ")}` : "",
    goal.stopWhenSatisfied ? "Zatrzymaj gdy cel spełniony: tak" : "",
  ]
    .filter(Boolean)
    .join("\n");

  const reconLines = [
    `Plik: ${recon.title}`,
    `Typ treści: ${recon.classification.primaryType}`,
    `Strategia sugerowana: ${recon.classification.suggestedStrategy}`,
    recon.classification.signals.length
      ? `Sygnały: ${recon.classification.signals.slice(0, 5).join(", ")}`
      : "",
    recon.briefLines.length
      ? `Opis: ${recon.briefLines.slice(0, 3).join(" | ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = [
    "Przeanalizuj intencję użytkownika i zwróć ścisły JSON (bez markdown fences).",
    "",
    goalLines,
    "",
    reconLines,
    "",
    "Pola JSON:",
    "- intentType: jeden z wartości:",
    "    exhaustive_read      — użytkownik chce przeczytać całość / pełne pokrycie",
    "    question_answering   — odpowiedź na konkretne pytania o tekst",
    "    targeted_extraction  — zebranie wszystkich wystąpień X z całego tekstu",
    "    analysis             — analiza tematyczna, interpretacja, ocena",
    "    structure_survey     — poznanie struktury, TOC, zawartości pliku",
    "- strategicGoal: 1-2 zdania — co użytkownik chce osiągnąć jako efekt końcowy",
    "- intermediateGoals: 2-4 kroki pośrednie w logicznej kolejności",
    "- focusAreas: 2-6 konkretnych obszarów tematycznych / encji / sekcji do priorytetyzacji",
    "- skipHeuristics: 1-4 rodzaje treści które można bezpiecznie pominąć lub czytać pobieżnie",
    "- prioritySignals: 1-4 markery tekstowe na które szczególnie zwracać uwagę (np. definicje, twierdzenia, wzory, daty)",
  ].join("\n");

  try {
    const result = await generateText({
      model: openai(model),
      system: "Jesteś routerem intencji czytelnika. Zwróć wyłącznie poprawny JSON.",
      prompt,
      temperature: 0,
      maxTokens: 600,
    });

    return intentSchema.parse(parseLooseJson(result.text));
  } catch {
    return buildFallbackIntent(session);
  }
}

function buildFallbackIntent(session: ReaderSession): ReaderIntent {
  const { mode, prompt, questions, targetEntities } = session.goal;

  const hasQuestions = (questions?.length ?? 0) > 0;
  const hasTargets = (targetEntities?.length ?? 0) > 0;

  let intentType: ReaderIntentType;
  if (mode === ReaderMode.Exhaustive) intentType = ReaderIntentType.ExhaustiveRead;
  else if (hasQuestions) intentType = ReaderIntentType.QuestionAnswering;
  else if (hasTargets) intentType = ReaderIntentType.TargetedExtraction;
  else intentType = ReaderIntentType.Analysis;

  return {
    intentType,
    strategicGoal: prompt,
    intermediateGoals: [
      "Zbadaj strukturę pliku",
      "Przeczytaj kluczowe sekcje",
      "Zapisz ustalenia",
    ],
    focusAreas: [...(questions ?? []), ...(targetEntities ?? [])].slice(0, 6),
    skipHeuristics: [],
    prioritySignals: [],
  };
}
