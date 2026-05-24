import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { runReaderOrchestration } from "@/lib/reader/orchestration";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await runReaderOrchestration(body);

    return NextResponse.json({
      session: result.session,
      handoff: result.handoff,
      notes: result.notes,
      startedNewSession: result.startedNewSession,
      model: result.model,
      usage: result.usage,
    });
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

    const message = error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      {
        error: "Reader orchestration failed",
        message,
      },
      { status: 500 }
    );
  }
}