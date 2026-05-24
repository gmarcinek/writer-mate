import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import {
  createReaderSessionEvent,
  serializeReaderSessionEvent,
  type ReaderSessionEvent,
} from "@/lib/reader/events";
import {
  readerOrchestrationInputSchema,
  runReaderOrchestration,
} from "@/lib/reader/orchestration";
import { createReaderSession } from "@/lib/reader/persistence";
import { ReaderSessionStatus } from "@/lib/reader/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const readerStreamResumeInputSchema = z.object({
  sessionId: z.string().uuid(),
  model: z.string().min(1).optional(),
});

function buildSseHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

function createReaderSessionStream(
  input: Parameters<typeof runReaderOrchestration>[0],
  requestSignal: AbortSignal
) {
  const encoder = new TextEncoder();
  const requestedSessionId = "sessionId" in input ? input.sessionId : null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let emittedError = false;

      const closeStream = () => {
        if (closed) {
          return;
        }

        closed = true;
        controller.close();
      };

      const enqueueEvent = (event: ReaderSessionEvent) => {
        if (closed) {
          return;
        }

        if (event.type === "error") {
          emittedError = true;
        }

        controller.enqueue(encoder.encode(serializeReaderSessionEvent(event)));
      };

      requestSignal.addEventListener("abort", closeStream, { once: true });

      controller.enqueue(encoder.encode(": reader session stream opened\n\n"));

      void (async () => {
        try {
          await runReaderOrchestration(input, {
            onEvent: enqueueEvent,
          });
        } catch (error) {
          if (!emittedError && requestedSessionId) {
            enqueueEvent(
              createReaderSessionEvent("error", requestedSessionId, {
                stage: "unknown",
                message:
                  error instanceof Error
                    ? error.message
                    : "Unknown reader orchestration error",
              })
            );
          }
        } finally {
          closeStream();
        }
      })();
    },
  });
}

function createReaderSessionStreamResponse(
  input: Parameters<typeof runReaderOrchestration>[0],
  requestSignal: AbortSignal
) {
  return new Response(createReaderSessionStream(input, requestSignal), {
    headers: buildSseHeaders(),
  });
}

async function prepareReaderSessionStreamInput(
  input: Parameters<typeof runReaderOrchestration>[0]
): Promise<Parameters<typeof runReaderOrchestration>[0]> {
  if ("sessionId" in input) {
    return input;
  }

  const session = await createReaderSession({
    source: input.source,
    goal: input.goal,
    status: ReaderSessionStatus.Recon,
    reconSummary: undefined,
  });

  return {
    sessionId: session.id,
    model: input.model,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const input = readerStreamResumeInputSchema.parse({
      sessionId: searchParams.get("sessionId"),
      model: searchParams.get("model") ?? undefined,
    });

    return createReaderSessionStreamResponse(input, request.signal);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid reader stream request",
          details: error.flatten(),
        },
        { status: 400 }
      );
    }

    throw error;
  }
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: "Invalid reader orchestration request",
        message: "Request body must be valid JSON",
      },
      { status: 400 }
    );
  }

  try {
    const input = readerOrchestrationInputSchema.parse(body);
    const streamInput = await prepareReaderSessionStreamInput(input);

    return createReaderSessionStreamResponse(streamInput, request.signal);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid reader orchestration request",
          details: error.flatten(),
        },
        { status: 400 }
      );
    }

    throw error;
  }
}