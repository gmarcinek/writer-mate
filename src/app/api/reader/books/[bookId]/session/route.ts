import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { ZodError, z } from "zod";
import { db } from "@/lib/db";
import { createReaderSession, getLatestReaderSessionArtifactsForBook } from "@/lib/reader/persistence";
import { ReaderMode, ReaderSessionStatus, ReaderSourceType } from "@/lib/reader/types";
import { books } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  bookId: z.string().uuid(),
});

const createSessionBodySchema = z.object({
  prompt: z.string().trim().min(1),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ bookId: string }> }
) {
  try {
    const params = paramsSchema.parse(await context.params);
    const artifacts = await getLatestReaderSessionArtifactsForBook(params.bookId);

    return NextResponse.json(artifacts);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid reader book session request",
          details: error.flatten(),
        },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      {
        error: "Failed to load reader session",
        message,
      },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ bookId: string }> }
) {
  try {
    const params = paramsSchema.parse(await context.params);
    const body = createSessionBodySchema.parse(await request.json());
    const rows = await db
      .select({ id: books.id, title: books.title })
      .from(books)
      .where(eq(books.id, params.bookId))
      .limit(1);

    const book = rows[0];

    if (!book) {
      return NextResponse.json(
        {
          error: "Book not found",
        },
        { status: 404 }
      );
    }

    const session = await createReaderSession({
      source: {
        sourceId: book.id,
        sourceType: ReaderSourceType.BookRawContent,
        bookId: book.id,
        title: book.title,
      },
      goal: {
        mode: ReaderMode.Exhaustive,
        prompt: body.prompt,
        requiredCoverage: {
          minimumLineCoveragePercent: 100,
          requireEndToEndRead: true,
        },
      },
      status: ReaderSessionStatus.Recon,
      reconSummary: undefined,
    });

    return NextResponse.json({ session });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid reader book session request",
          details: error.flatten(),
        },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      {
        error: "Failed to create reader session",
        message,
      },
      { status: 500 }
    );
  }
}