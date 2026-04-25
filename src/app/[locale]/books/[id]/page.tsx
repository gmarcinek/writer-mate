import { notFound } from "next/navigation";
import { getBookById } from "@/app/actions/books";

export default async function BookPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id } = await params;
  const book = await getBookById(id);
  if (!book) notFound();

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-xl font-semibold text-[var(--color-foreground)] mb-4">
        {book.title}
      </h1>
      {book.rawContent ? (
        <pre className="whitespace-pre-wrap text-sm text-[var(--color-foreground)] font-[var(--font-serif)] leading-relaxed">
          {book.rawContent}
        </pre>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)] italic">Brak treści</p>
      )}
    </div>
  );
}