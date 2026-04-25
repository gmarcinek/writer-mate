import { notFound } from "next/navigation";
import { getBookById } from "@/app/actions/books";
import PaperToggle from "./PaperToggle";

export default async function BookPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id } = await params;
  const book = await getBookById(id);
  if (!book) notFound();

  return (
    <div style={{ height: "100%", overflowY: "auto" }}>
      {book.rawContent ? (
        <PaperToggle title={book.title} content={book.rawContent} />
      ) : (
        <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p style={{ fontSize: "14px", color: "var(--color-text-muted)", fontStyle: "italic" }}>
            Brak treści
          </p>
        </div>
      )}
    </div>
  );
}