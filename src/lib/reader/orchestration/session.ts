import "server-only";

import {
  createReaderSession,
  getReaderSession,
  updateReaderSession,
} from "@/lib/reader/persistence";
import {
  createReaderSessionEvent,
  type ReaderSessionEventSink,
} from "@/lib/reader/events";
import { runReaderReconnaissance } from "@/lib/reader/reconnaissance";
import { ReaderSessionStatus, type ReaderSourceRef, type ReaderGoal } from "@/lib/reader/types";
import {
  DEFAULT_READER_MODEL,
  startSessionInputSchema,
  type ReaderOrchestrationInput,
} from "./schemas";

export async function resolveSessionContext(
  input: ReaderOrchestrationInput,
  options?: { onEvent?: ReaderSessionEventSink }
) {
  const parsed = startSessionInputSchema.parse(input);
  const emit = options?.onEvent;

  if ("sessionId" in parsed) {
    const session = await getReaderSession(parsed.sessionId);

    if (!session) {
      throw new Error("Reader session not found");
    }

    await emit?.(
      createReaderSessionEvent("thinking", session.id, {
        stage: "recon",
        message: "Running reconnaissance for the existing reader session.",
      })
    );

    const recon = await runReaderReconnaissance(session.source);

    if (!session.reconSummary) {
      const updatedSession = await updateReaderSession({
        sessionId: session.id,
        status: ReaderSessionStatus.Recon,
        reconSummary: recon.summary,
      });

      if (updatedSession) {
        await emit?.(
          createReaderSessionEvent("status", updatedSession.id, {
            status: updatedSession.status,
            phase: "recon",
            message: "Reader reconnaissance summary refreshed.",
            startedNewSession: false,
          })
        );
      }
    } else {
      await emit?.(
        createReaderSessionEvent("status", session.id, {
          status: session.status,
          phase: "recon",
          message: "Reader reconnaissance summary reused from the persisted session.",
          startedNewSession: false,
        })
      );
    }

    return {
      session:
        session.reconSummary
          ? session
          : ((await getReaderSession(session.id)) ?? session),
      recon,
      model: parsed.model ?? DEFAULT_READER_MODEL,
      startedNewSession: false,
    };
  }

  const session = await createReaderSession({
    source: parsed.source as ReaderSourceRef,
    goal: parsed.goal as ReaderGoal,
    status: ReaderSessionStatus.Recon,
    reconSummary: undefined,
  });

  await emit?.(
    createReaderSessionEvent("thinking", session.id, {
      stage: "recon",
      message: "Running reconnaissance for a new reader session.",
    })
  );
  await emit?.(
    createReaderSessionEvent("status", session.id, {
      status: session.status,
      phase: "recon",
      message: "Reader session created; reconnaissance is starting.",
      startedNewSession: true,
    })
  );

  const recon = await runReaderReconnaissance(parsed.source as ReaderSourceRef);
  const sessionWithRecon =
    (await updateReaderSession({
      sessionId: session.id,
      status: ReaderSessionStatus.Recon,
      reconSummary: recon.summary,
    })) ?? session;

  return {
    session: sessionWithRecon,
    recon,
    model: parsed.model ?? DEFAULT_READER_MODEL,
    startedNewSession: true,
  };
}
