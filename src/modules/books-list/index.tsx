import Link from "next/link";
import { getBooks } from "@/app/actions/books";
import DeleteButton from "./DeleteButton";

export default async function BookList() {
  const books = await getBooks();

  return (
    <section className="flex flex-col gap-2">
      <p
        style={{
          fontSize: "11px",
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-text-muted)",
          padding: "0 4px",
        }}
      >
        Biblioteka
      </p>
      {books.length === 0 ? (
        <p style={{ fontSize: "13px", color: "var(--color-text-muted)", fontStyle: "italic", padding: "4px" }}>
          Brak projektów
        </p>
      ) : (
        <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "2px" }}>
          {books.map((book) => (
            <li
              key={book.id}
              className="group"
              style={{ display: "flex", alignItems: "center", borderRadius: "6px" }}
            >
              <Link
                href={`/books/${book.id}`}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                  padding: "8px 8px",
                  textDecoration: "none",
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "var(--color-foreground)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {book.title}
                </span>
                <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
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
