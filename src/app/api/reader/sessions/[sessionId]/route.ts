import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getReaderSessionArtifacts } from "@/lib/reader/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ sessionId: z.string().uuid() });

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const params = paramsSchema.parse(await context.params);
    const artifacts = await getReaderSessionArtifacts(params.sessionId);
    return NextResponse.json(artifacts);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get session artifacts" },
      { status: 500 }
    );
  }
}