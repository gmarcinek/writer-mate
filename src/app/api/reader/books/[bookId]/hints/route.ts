import "server-only";
import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import {
  createReaderHint,
  listReaderHintsForBook,
} from "@/lib/reader/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ bookId: z.string().uuid() });

const createHintBodySchema = z.object({
  sessionId: z.string().uuid(),
  description: z.string().min(1),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  fragment: z.string(),
  proposedChange: z.string().min(1),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ bookId: string }> }
) {
  try {
    const { bookId } = paramsSchema.parse(await context.params);
    const hints = await listReaderHintsForBook(bookId);
    return NextResponse.json({ hints });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list hints" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ bookId: string }> }
) {
  try {
    const { bookId } = paramsSchema.parse(await context.params);
    const body = createHintBodySchema.parse(await request.json());
    const hint = await createReaderHint({ bookId, ...body });
    return NextResponse.json({ hint }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid hint data", details: error.flatten() },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create hint" },
      { status: 500 }
    );
  }
}
