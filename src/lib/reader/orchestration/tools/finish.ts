import "server-only";

import { tool } from "ai";
import { finish as finishReaderSession } from "@/lib/reader/checkpoint-tools";
import {
  getReaderSession,
  getReaderSessionArtifacts,
  saveReaderHandoff,
  updateReaderSession,
} from "@/lib/reader/persistence";
import { createReaderSessionEvent } from "@/lib/reader/events";
import { ReaderSessionStatus, type ReaderLineRange } from "@/lib/reader/types";
import { finishToolSchema } from "../schemas";
import {
  isTerminalStatus,
  normalizeEvidence,
  summarizeCoverageLedger,
} from "../utils";
import { synthesizeHandoff, updateMasterHandoff } from "../synthesis";
import type { ToolContext } from "./context";

export function buildFinishModule(ctx: ToolContext) {
  const { session, recon, model, emit, state, startedNewSession } = ctx;

  const doSynthesisAndFinish = async (cursorArg?: ReaderLineRange | null) => {
    const artifactsForSynthesis = await getReaderSessionArtifacts(session.id);
    const finalCursor = cursorArg ?? state.currentCursor ?? undefined;

    if (artifactsForSynthesis.notes.length === 0) {
      await updateReaderSession({
        sessionId: session.id,
        status: ReaderSessionStatus.Partial,
        cursor: finalCursor ?? null,
      });
      await emit?.(
        createReaderSessionEvent("status", session.id, {
          status: ReaderSessionStatus.Partial,
          phase: "terminal",
          message: "Session closed — no notes were saved.",
          startedNewSession,
        })
      );
      return {
        sessionId: session.id,
        status: ReaderSessionStatus.Partial as "complete" | "partial",
        handoffId: "",
        savedAt: new Date().toISOString(),
        uncoveredRanges: [] as ReaderLineRange[],
      };
    }

    await updateReaderSession({
      sessionId: session.id,
      status: ReaderSessionStatus.Synthesizing,
      cursor: finalCursor ?? null,
    });
    await emit?.(
      createReaderSessionEvent("thinking", session.id, {
        stage: "synthesis",
        message: "Reading complete; synthesizing the persisted notes into a handoff.",
      })
    );
    await emit?.(
      createReaderSessionEvent("status", session.id, {
        status: ReaderSessionStatus.Synthesizing,
        phase: "synthesis",
        message: "Reader session is synthesizing the final handoff.",
        startedNewSession,
      })
    );

    const coverageSummary = summarizeCoverageLedger(
      recon.stats.totalLines,
      artifactsForSynthesis.coverage
    );
    const normalizedEvidence = normalizeEvidence(artifactsForSynthesis.notes);
    const synthesis = await synthesizeHandoff({
      session,
      recon,
      notes: artifactsForSynthesis.notes,
      coverageSummary,
      model,
    });
    const handoff = await saveReaderHandoff({
      sessionId: session.id,
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
      createReaderSessionEvent("handoff_ready", session.id, {
        handoffId: handoff.id,
        status: handoff.status,
        executiveSummary: handoff.executiveSummary,
        coverageSummary: handoff.coverageSummary,
      })
    );

    return await finishReaderSession({
      sessionId: session.id,
      cursor: finalCursor,
    });
  };

  const doSynthesisAndFinishWithMaster = async (cursorArg?: ReaderLineRange | null) => {
    const finishResult = await doSynthesisAndFinish(cursorArg);
    const masterBookId = session.source.bookId;
    if (masterBookId) {
      try {
        await updateMasterHandoff(masterBookId, model);
      } catch {
        // non-fatal
      }
    }
    return finishResult;
  };

  const finishTool = tool({
    description:
      "Signal that reading is complete. The server will synthesize a final handoff and close the session.",
    parameters: finishToolSchema,
    execute: async ({ cursor }) => {
      await emit?.(
        createReaderSessionEvent("tool_call", session.id, {
          toolName: "finish",
          input: { cursor },
        })
      );
      // Guard against double-finish (e.g. auto-finish already ran inside saveNotes)
      const currentSession = await getReaderSession(session.id);
      if (currentSession && isTerminalStatus(currentSession.status)) {
        const earlyResult = {
          sessionId: session.id,
          status: currentSession.status,
          alreadyFinished: true,
        };
        await emit?.(
          createReaderSessionEvent("tool_result", session.id, {
            toolName: "finish",
            ok: true,
            result: earlyResult,
          })
        );
        return earlyResult;
      }
      try {
        const result = await doSynthesisAndFinishWithMaster(cursor);
        await emit?.(
          createReaderSessionEvent("tool_result", session.id, {
            toolName: "finish",
            ok: true,
            result,
          })
        );
        return result;
      } catch (error) {
        await emit?.(
          createReaderSessionEvent("tool_result", session.id, {
            toolName: "finish",
            ok: false,
            errorMessage: error instanceof Error ? error.message : "Unknown tool error",
          })
        );
        throw error;
      }
    },
  });

  return { doSynthesisAndFinish, doSynthesisAndFinishWithMaster, finishTool };
}
