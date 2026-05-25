import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getReaderMasterHandoff, listReaderSessionsForBook } from "@/lib/reader/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ bookId: z.string().uuid() });

export async function GET(_request: Request, context: { params: Promise<{ bookId: string }> }) {
  try {
    const params = paramsSchema.parse(await context.params);
    const [sessions, masterHandoff] = await Promise.all([
      listReaderSessionsForBook(params.bookId),
      getReaderMasterHandoff(params.bookId),
    ]);
    return NextResponse.json({ sessions, masterHandoff });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list sessions" },
      { status: 500 }
    );
  }
}