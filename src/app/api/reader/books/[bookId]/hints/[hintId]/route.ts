import "server-only";
import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { deleteReaderHint, updateReaderHint } from "@/lib/reader/persistence";
import { ReaderHintStatus } from "@/lib/reader/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  bookId: z.string().uuid(),
  hintId: z.string().uuid(),
});

const patchBodySchema = z.object({
  status: z.nativeEnum(ReaderHintStatus).optional(),
  proposedChange: z.string().min(1).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ bookId: string; hintId: string }> }
) {
  try {
    const { hintId } = paramsSchema.parse(await context.params);
    const body = patchBodySchema.parse(await request.json());
    const patch: Parameters<typeof updateReaderHint>[1] = {};

    if (body.status !== undefined) {
      patch.status = body.status;
      if (body.status === ReaderHintStatus.Applied) {
        patch.appliedAt = new Date();
      }
    }

    if (body.proposedChange !== undefined) {
      patch.proposedChange = body.proposedChange;
    }

    const hint = await updateReaderHint(hintId, patch);
    return NextResponse.json({ hint });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid patch data", details: error.flatten() },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update hint" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ bookId: string; hintId: string }> }
) {
  try {
    const { hintId } = paramsSchema.parse(await context.params);
    await deleteReaderHint(hintId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete hint" },
      { status: 500 }
    );
  }
}
