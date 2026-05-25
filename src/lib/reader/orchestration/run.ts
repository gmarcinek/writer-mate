import "server-only";

import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { z } from "zod";
import {
  getReaderSession,
  getReaderSessionArtifacts,
  saveReaderHandoff,
  updateReaderSession,
} from "@/lib/reader/persistence";
import {
  buildReaderFinishPrompt,
  buildReaderRunPrompt,
  buildReaderSystemPrompt,
} from "@/lib/reader/orchestration-prompt";
import {
  createReaderSessionEvent,
  type ReaderSessionEventSink,
} from "@/lib/reader/events";
import { ReaderSessionStatus } from "@/lib/reader/types";
import {
  MAX_READER_STEPS,
  type ReaderOrchestrationInput,
  type ReaderOrchestrationResult,
  type ReaderOrchestrationStage,
  type RunReaderOrchestrationOptions,
} from "./schemas";
import {
  isTerminalStatus,
  normalizeEvidence,
  persistableCursor,
  summarizeCoverageLedger,
} from "./utils";
import { resolveSessionContext } from "./session";
import { synthesizeHandoff } from "./synthesis";
import { createReaderTools } from "./tools";

export async function runReaderOrchestration(
  input: ReaderOrchestrationInput,
  options?: RunReaderOrchestrationOptions
): Promise<ReaderOrchestrationResult> {
  const emit = options?.onEvent;
  let currentStage: ReaderOrchestrationStage = "recon";
  let context: Awaited<ReturnType<typeof resolveSessionContext>> | null = null;
  const initialSessionId =
    typeof input === "object" &&
    input !== null &&
    "sessionId" in input &&
    z.string().uuid().safeParse(input.sessionId).success
      ? input.sessionId
      : null;
  let sessionId = initialSessionId;

  try {
    context = await resolveSessionContext(input, options);
    sessionId = context.session.id;

    if (isTerminalStatus(context.session.status)) {
      const artifacts = await getReaderSessionArtifacts(sessionId);

      if (!artifacts.session) {
        throw new Error("Reader session disappeared during orchestration");
      }

      await emit?.(
        createReaderSessionEvent("status", artifacts.session.id, {
          status: artifacts.session.status,
          phase: "terminal",
          message: "Reader session was already terminal; returning persisted artifacts.",
          startedNewSession: context.startedNewSession,
        })
      );

      return {
        session: artifacts.session,
        notes: artifacts.notes,
        handoff: artifacts.handoff,
        startedNewSession: context.startedNewSession,
        model: context.model,
      };
    }

    const initialArtifacts = await getReaderSessionArtifacts(sessionId);
    const currentSession = initialArtifacts.session ?? context.session;
    const toolRuntime = await createReaderTools({
      session: currentSession,
      recon: context.recon,
      model: context.model,
      noteCount: initialArtifacts.notes.length,
      startedNewSession: context.startedNewSession,
      onEvent: emit,
    });

    currentStage = "reading";
    await emit?.(
      createReaderSessionEvent("thinking", sessionId, {
        stage: "reading",
        message: "Reader orchestration is entering the tool-driven reading loop.",
      })
    );

    const readingSession = await updateReaderSession({
      sessionId,
      status: ReaderSessionStatus.Reading,
      reconSummary: context.recon.summary,
      cursor: persistableCursor(currentSession.cursor),
    });

    if (readingSession) {
      await emit?.(
        createReaderSessionEvent("status", sessionId, {
          status: readingSession.status,
          phase: "reading",
          message: "Reader session is now reading.",
          startedNewSession: context.startedNewSession,
        })
      );
    }

    const readingResult = await generateText({
      model: openai(context.model),
      system: buildReaderSystemPrompt(),
      prompt: buildReaderRunPrompt({
        recon: context.recon,
        session: currentSession,
        existingNoteCount: initialArtifacts.notes.length,
      }),
      tools: toolRuntime.tools,
      maxSteps: MAX_READER_STEPS,
      maxTokens: 1_200,
      temperature: 0.2,
    });

    const artifactsAfterReading = await getReaderSessionArtifacts(sessionId);
    const sessionAfterReading = artifactsAfterReading.session;

    if (!sessionAfterReading) {
      throw new Error("Reader session missing after reading loop");
    }

    // If the model called finish() during the reading loop, synthesis already ran inside finish.execute
    if (isTerminalStatus(sessionAfterReading.status)) {
      await emit?.(
        createReaderSessionEvent("status", sessionId, {
          status: sessionAfterReading.status,
          phase: "terminal",
          message: "Reader session finished successfully.",
          startedNewSession: context.startedNewSession,
        })
      );

      return {
        session: sessionAfterReading,
        notes: artifactsAfterReading.notes,
        handoff: artifactsAfterReading.handoff,
        startedNewSession: context.startedNewSession,
        model: context.model,
        usage: {
          totalTokens: readingResult.usage?.totalTokens ?? 0,
          inputTokens: readingResult.usage?.promptTokens ?? 0,
          outputTokens: readingResult.usage?.completionTokens ?? 0,
        },
      };
    }

    // Fallback: model exhausted maxSteps without calling finish — run server-side synthesis + close
    if (artifactsAfterReading.notes.length === 0) {
      const fallbackCursor = persistableCursor(
        toolRuntime.getCursor() ?? sessionAfterReading.cursor
      );
      await updateReaderSession({
        sessionId,
        status: ReaderSessionStatus.Partial,
        cursor: fallbackCursor,
      });
      await emit?.(
        createReaderSessionEvent("status", sessionId, {
          status: ReaderSessionStatus.Partial,
          phase: "terminal",
          message: "Reading session closed — no notes were saved.",
          startedNewSession: context.startedNewSession,
        })
      );
      return {
        session: { ...sessionAfterReading, status: ReaderSessionStatus.Partial },
        notes: [],
        handoff: null,
        startedNewSession: context.startedNewSession,
        model: context.model,
        usage: {
          totalTokens: readingResult.usage?.totalTokens ?? 0,
          inputTokens: readingResult.usage?.promptTokens ?? 0,
          outputTokens: readingResult.usage?.completionTokens ?? 0,
        },
      };
    }

    await updateReaderSession({
      sessionId,
      status: ReaderSessionStatus.Synthesizing,
      cursor: persistableCursor(toolRuntime.getCursor() ?? sessionAfterReading.cursor),
    });

    currentStage = "synthesis";
    await emit?.(
      createReaderSessionEvent("thinking", sessionId, {
        stage: "synthesis",
        message: "Reading loop completed; synthesizing the persisted notes into a handoff.",
      })
    );
    await emit?.(
      createReaderSessionEvent("status", sessionId, {
        status: ReaderSessionStatus.Synthesizing,
        phase: "synthesis",
        message: "Reader session is synthesizing the final handoff.",
        startedNewSession: context.startedNewSession,
      })
    );

    const coverageSummary = summarizeCoverageLedger(
      context.recon.stats.totalLines,
      artifactsAfterReading.coverage
    );
    const normalizedEvidence = normalizeEvidence(artifactsAfterReading.notes);
    const synthesis = await synthesizeHandoff({
      session: sessionAfterReading,
      recon: context.recon,
      notes: artifactsAfterReading.notes,
      coverageSummary,
      model: context.model,
    });
    const handoff = await saveReaderHandoff({
      sessionId,
      status: synthesis.draft.status,
      executiveSummary: synthesis.draft.executiveSummary,
      conclusions: synthesis.draft.conclusions.map((item) => ({
        ...item,
        statementKind: item.statementKind,
      })),
      gaps: synthesis.draft.gaps,
      caveats: synthesis.draft.caveats,
      limitations: synthesis.draft.limitations,
      nextQuestions: synthesis.draft.nextQuestions,
      evidence: normalizedEvidence,
      coverageSummary,
    });

    await emit?.(
      createReaderSessionEvent("handoff_ready", sessionId, {
        handoffId: handoff.id,
        status: handoff.status,
        executiveSummary: handoff.executiveSummary,
        coverageSummary: handoff.coverageSummary,
      })
    );

    currentStage = "finish";
    await emit?.(
      createReaderSessionEvent("thinking", sessionId, {
        stage: "finish",
        message: "Final handoff persisted; closing the session.",
      })
    );

    await generateText({
      model: openai(context.model),
      system: buildReaderSystemPrompt(),
      prompt: buildReaderFinishPrompt(sessionId),
      tools: { finish: toolRuntime.tools.finish },
      toolChoice: { type: "tool", toolName: "finish" },
      experimental_activeTools: ["finish"],
      maxSteps: 2,
      maxTokens: 200,
      temperature: 0,
    });

    const finalArtifacts = await getReaderSessionArtifacts(sessionId);

    if (!finalArtifacts.session) {
      throw new Error("Reader session missing after finish");
    }

    await emit?.(
      createReaderSessionEvent("status", sessionId, {
        status: finalArtifacts.session.status,
        phase: "terminal",
        message: "Reader session finished successfully.",
        startedNewSession: context.startedNewSession,
      })
    );

    return {
      session: finalArtifacts.session,
      notes: finalArtifacts.notes,
      handoff: finalArtifacts.handoff ?? handoff,
      startedNewSession: context.startedNewSession,
      model: context.model,
      usage: {
        totalTokens:
          (readingResult.usage?.totalTokens ?? 0) + (synthesis.usage?.totalTokens ?? 0),
        inputTokens:
          (readingResult.usage?.promptTokens ?? 0) + (synthesis.usage?.promptTokens ?? 0),
        outputTokens:
          (readingResult.usage?.completionTokens ?? 0) +
          (synthesis.usage?.completionTokens ?? 0),
      },
    };
  } catch (error) {
    if (!sessionId) {
      throw error;
    }

    const latestSession = await getReaderSession(sessionId);

    const failedSession = latestSession
      ? await updateReaderSession({
          sessionId,
          status: ReaderSessionStatus.Failed,
          cursor: persistableCursor(
            latestSession.cursor ?? context?.session.cursor ?? null
          ),
        })
      : null;

    await emit?.(
      createReaderSessionEvent("error", sessionId, {
        stage: currentStage,
        message: error instanceof Error ? error.message : "Unknown reader orchestration error",
      })
    );

    if (failedSession) {
      await emit?.(
        createReaderSessionEvent("status", sessionId, {
          status: failedSession.status,
          phase: "terminal",
          message: "Reader session failed.",
          startedNewSession: context?.startedNewSession ?? false,
        })
      );
    }

    throw error;
  }
}
