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
      style={{
        flexShrink: 0,
        marginLeft: "auto",
        padding: "4px 6px",
        background: "transparent",
        border: "none",
        borderRadius: "4px",
        cursor: isPending ? "not-allowed" : "pointer",
        color: "var(--color-text-muted)",
        opacity: isPending ? 0.3 : 1,
        transition: "color 0.15s, background 0.15s",
        lineHeight: 1,
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.color = "var(--color-error)";
        e.currentTarget.style.background = "var(--color-surface-hover)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.color = "var(--color-text-muted)";
        e.currentTarget.style.background = "transparent";
      }}
    >
      {isPending ? (
        <span style={{ fontSize: "12px" }}>…</span>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
      )}
    </button>
  );
}
