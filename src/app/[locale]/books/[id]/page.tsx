import { notFound } from "next/navigation";
import { getBookById, getBooks } from "@/app/actions/books";
import BookWorkspace from "@/modules/book-workspace";

export default async function BookPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id, locale } = await params;
  const [book, books] = await Promise.all([getBookById(id), getBooks()]);
  if (!book) notFound();

  return (
    <BookWorkspace
      bookId={book.id}
      locale={locale}
      books={books.map((item) => ({ id: item.id, title: item.title }))}
      title={book.title}
      content={book.rawContent ?? ""}
    />
  );
}