"use client";

import { useRouter } from "next/navigation";
import PaperToggle from "@/app/[locale]/books/[id]/PaperToggle";
import styles from "./BookWorkspace.module.scss";

type BookWorkspaceProps = {
  bookId: string;
  locale: string;
  books: Array<{ id: string; title: string }>;
  title: string;
  content: string;
};

export default function BookWorkspace({ bookId, locale, books, title, content }: BookWorkspaceProps) {
  const router = useRouter();

  return (
    <section className={styles.workspace}>
      <header className={styles.topBar}>
        <div className={styles.projectInfo}>
          <div className={styles.projectSelectWrap}>
            <span className={styles.projectName}>{title}</span>
            <select
              className={styles.projectSelect}
              value={bookId}
              onChange={(event) => router.push(`/${locale}/books/${event.target.value}`)}
            >
              {books.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.title}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <div className={styles.bookContent}>
        {content ? (
          <PaperToggle title={title} content={content} showToolbar={false} />
        ) : (
          <div className={styles.emptyState}>
            <p>Brak treści</p>
          </div>
        )}
      </div>
    </section>
  );
}
