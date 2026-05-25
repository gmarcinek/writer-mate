"use server";

import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { createReaderSession } from "@/lib/reader/persistence";
import { ReaderMode, ReaderSourceType, ReaderSessionStatus, type ReaderGoal } from "@/lib/reader/types";
import { books } from "@/lib/schema";

export type BookItem = {
  id: string;
  title: string;
  author: string | null;
  status: string;
  createdAt: Date;
};

const TEXT_EXTENSIONS = new Set([".txt", ".md"]);

const INITIAL_EXHAUSTIVE_READER_GOAL = {
  mode: ReaderMode.Exhaustive,
  prompt:
    "Read this source exhaustively from beginning to end and produce the initial baseline handoff for the full book.",
  requiredCoverage: {
    minimumLineCoveragePercent: 100,
    requireEndToEndRead: true,
  },
} satisfies ReaderGoal;

export type UploadBookResult = {
  id: string;
  title: string;
  sessionId: string;
};

async function toMarkdown(file: File): Promise<string> {
  const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();

  if (TEXT_EXTENSIONS.has(ext)) {
    return await file.text();
  }

  const markitdownUrl = process.env.MARKITDOWN_URL;
  if (!markitdownUrl) throw new Error("MARKITDOWN_URL not set");

  const form = new FormData();
  form.append("file", file, file.name);

  const res = await fetch(`${markitdownUrl}/convert/file`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Markitdown error ${res.status}: ${detail}`);
  }

  const json = (await res.json()) as { markdown: string };
  return json.markdown;
}

export async function uploadBook(
  formData: FormData
): Promise<UploadBookResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Brak pliku");
  }

  const rawContent = await toMarkdown(file);
  const title = file.name.replace(/\.[^.]+$/, "");

  const [inserted] = await db
    .insert(books)
    .values({ title, fileOriginalName: file.name, rawContent, status: "ready" })
    .returning({ id: books.id, title: books.title });

  const session = await createReaderSession({
    source: {
      sourceId: inserted.id,
      sourceType: ReaderSourceType.BookRawContent,
      title: inserted.title,
      bookId: inserted.id,
    },
    goal: INITIAL_EXHAUSTIVE_READER_GOAL,
    status: ReaderSessionStatus.Recon,
    reconSummary: undefined,
  });

  revalidatePath("/pl");
  revalidatePath("/en");

  return {
    ...inserted,
    sessionId: session.id,
  };
}

export async function getBooks(): Promise<BookItem[]> {
  return db
    .select({
      id: books.id,
      title: books.title,
      author: books.author,
      status: books.status,
      createdAt: books.createdAt,
    })
    .from(books)
    .orderBy(desc(books.createdAt));
}

export async function deleteBook(id: string): Promise<void> {
  await db.delete(books).where(eq(books.id, id));
  revalidatePath("/pl");
  revalidatePath("/en");
}

export async function getBookById(
  id: string
): Promise<{ id: string; title: string; rawContent: string | null } | null> {
  const rows = await db
    .select({ id: books.id, title: books.title, rawContent: books.rawContent })
    .from(books)
    .where(eq(books.id, id))
    .limit(1);
  return rows[0] ?? null;
}
