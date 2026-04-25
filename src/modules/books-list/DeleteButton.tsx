"use client";

import { useTransition } from "react";
import { deleteBook } from "@/app/actions/books";

export default function DeleteButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm("Usunąć tę książkę?")) return;
    startTransition(() => deleteBook(id));
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      aria-label="Usuń książkę"
      className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-error)] disabled:opacity-30 p-0.5 rounded"
    >
      {isPending ? "…" : "✕"}
    </button>
  );
}
