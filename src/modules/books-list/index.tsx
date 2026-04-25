import Link from "next/link";
import { getBooks } from "@/app/actions/books";
import DeleteButton from "./DeleteButton";

export default async function BookList() {
  const books = await getBooks();

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        Biblioteka
      </h2>
      {books.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)] italic">Brak książek</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {books.map((book) => (
            <li
              key={book.id}
              className="group flex items-center gap-1 rounded-md hover:bg-[var(--color-surface-hover)] text-sm"
            >
              <Link
                href={`/books/${book.id}`}
                className="flex flex-col gap-0.5 px-2 py-1.5 min-w-0 flex-1"
              >
                <span className="font-medium text-[var(--color-foreground)] truncate">
                  {book.title}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {book.createdAt.toLocaleDateString("pl-PL")}
                </span>
              </Link>
              <DeleteButton id={book.id} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
