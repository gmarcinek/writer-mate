"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { ReaderHintStatus, type ReaderHint } from "@/lib/reader/types";
import styles from "./HintsPanel.module.scss";

function isBookPage(pathname: string) {
  return /^\/[a-z]{2}\/books\/[^/]+$/.test(pathname);
}

type EditingState = {
  hintId: string;
  proposedChange: string;
};

export default function HintsPanel() {
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();
  const bookId = typeof params.id === "string" ? params.id : null;
  const onBookPage = Boolean(bookId) && isBookPage(pathname);

  const [hints, setHints] = useState<ReaderHint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [activeHintId, setActiveHintId] = useState<string | null>(null);

  const loadHints = useCallback(async (bid: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/reader/books/${bid}/hints`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { hints: ReaderHint[] };
      setHints(data.hints);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!onBookPage || !bookId) {
      setHints([]);
      setActiveHintId(null);
      return;
    }
    void loadHints(bookId);
  }, [bookId, onBookPage, loadHints]);

  // Notify WorkspaceShell whenever the hints list changes
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("hints:updated", { detail: { count: hints.length } })
    );
  }, [hints]);

  // Listen for hint_emitted events from the workbench SSE
  useEffect(() => {
    if (!bookId) return;

    function onHintEmitted(e: Event) {
      const hint = (e as CustomEvent<ReaderHint>).detail;
      setHints((prev) => {
        const exists = prev.some((h) => h.id === hint.id);
        return exists ? prev : [hint, ...prev];
      });
    }

    window.addEventListener("hint:emitted", onHintEmitted);
    return () => window.removeEventListener("hint:emitted", onHintEmitted);
  }, [bookId]);

  function highlightHint(hint: ReaderHint) {
    setActiveHintId(hint.id);
    window.dispatchEvent(
      new CustomEvent("hint:select", {
        detail: {
          fragment: hint.fragment,
          startLine: hint.startLine,
          endLine: hint.endLine,
        },
      })
    );
  }

  async function applyHint(hint: ReaderHint) {
    if (!bookId) return;
    const res = await fetch(
      `/api/reader/books/${bookId}/hints/${hint.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: ReaderHintStatus.Applied }),
      }
    );
    if (!res.ok) return;
    const data = (await res.json()) as { hint: ReaderHint };
    setHints((prev) =>
      prev.map((h) => (h.id === hint.id ? data.hint : h))
    );
  }

  async function dismissHint(hint: ReaderHint) {
    if (!bookId) return;
    const res = await fetch(
      `/api/reader/books/${bookId}/hints/${hint.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: ReaderHintStatus.Dismissed }),
      }
    );
    if (!res.ok) return;
    const data = (await res.json()) as { hint: ReaderHint };
    setHints((prev) =>
      prev.map((h) => (h.id === hint.id ? data.hint : h))
    );
  }

  async function saveEdit(hint: ReaderHint, proposedChange: string) {
    if (!bookId) return;
    const res = await fetch(
      `/api/reader/books/${bookId}/hints/${hint.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposedChange }),
      }
    );
    if (!res.ok) return;
    const data = (await res.json()) as { hint: ReaderHint };
    setHints((prev) =>
      prev.map((h) => (h.id === hint.id ? data.hint : h))
    );
    setEditing(null);
  }

  if (!onBookPage) {
    return null;
  }

  const pendingHints = hints.filter(
    (h) => h.status === ReaderHintStatus.Pending
  );
  const otherHints = hints.filter(
    (h) => h.status !== ReaderHintStatus.Pending
  );

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Hints</p>
        <h2 className={styles.title}>
          Sugestie{" "}
          {pendingHints.length > 0 && (
            <span className={styles.badge}>{pendingHints.length}</span>
          )}
        </h2>
      </header>

      <div className={styles.body}>
        {isLoading && <p className={styles.muted}>Ładowanie...</p>}

        {!isLoading && hints.length === 0 && (
          <div className={styles.empty}>
            <p className={styles.emptyIcon}>💡</p>
            <p className={styles.muted}>
              Hinty pojawią się tutaj gdy model zauważy coś w tekście.
            </p>
          </div>
        )}

        {pendingHints.length > 0 && (
          <div className={styles.group}>
            {pendingHints.map((hint) => (
              <HintCard
                key={hint.id}
                hint={hint}
                active={activeHintId === hint.id}
                editing={editing?.hintId === hint.id ? editing : null}
                onFocus={() => highlightHint(hint)}
                onApply={() => void applyHint(hint)}
                onDismiss={() => void dismissHint(hint)}
                onEditStart={() =>
                  setEditing({ hintId: hint.id, proposedChange: hint.proposedChange })
                }
                onEditChange={(v) =>
                  setEditing((prev) =>
                    prev ? { ...prev, proposedChange: v } : null
                  )
                }
                onEditSave={(v) => void saveEdit(hint, v)}
                onEditCancel={() => setEditing(null)}
              />
            ))}
          </div>
        )}

        {otherHints.length > 0 && (
          <>
            <p className={styles.groupLabel}>Zamknięte</p>
            <div className={styles.group}>
              {otherHints.map((hint) => (
                <HintCard
                  key={hint.id}
                  hint={hint}
                  active={activeHintId === hint.id}
                  editing={null}
                  onFocus={() => highlightHint(hint)}
                  onApply={() => void applyHint(hint)}
                  onDismiss={() => void dismissHint(hint)}
                  onEditStart={() =>
                    setEditing({ hintId: hint.id, proposedChange: hint.proposedChange })
                  }
                  onEditChange={(v) =>
                    setEditing((prev) =>
                      prev ? { ...prev, proposedChange: v } : null
                    )
                  }
                  onEditSave={(v) => void saveEdit(hint, v)}
                  onEditCancel={() => setEditing(null)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function HintCard({
  hint,
  active,
  editing,
  onFocus,
  onApply,
  onDismiss,
  onEditStart,
  onEditChange,
  onEditSave,
  onEditCancel,
}: {
  hint: ReaderHint;
  active: boolean;
  editing: EditingState | null;
  onFocus: () => void;
  onApply: () => void;
  onDismiss: () => void;
  onEditStart: () => void;
  onEditChange: (v: string) => void;
  onEditSave: (v: string) => void;
  onEditCancel: () => void;
}) {
  const isPending = hint.status === ReaderHintStatus.Pending;
  const isApplied = hint.status === ReaderHintStatus.Applied;

  return (
    <article
      className={[
        styles.card,
        active ? styles.cardActive : "",
        isApplied ? styles.cardApplied : "",
        hint.status === ReaderHintStatus.Dismissed ? styles.cardDismissed : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onFocus}
    >
      {/* Line range badge */}
      <div className={styles.lineBadge}>
        L{hint.startLine}
        {hint.endLine !== hint.startLine ? `–${hint.endLine}` : ""}
      </div>

      {/* Description */}
      <p className={styles.description}>{hint.description}</p>

      {/* Fragment */}
      {hint.fragment && (
        <blockquote className={styles.fragment}>{hint.fragment}</blockquote>
      )}

      {/* Proposed change */}
      {editing ? (
        <div className={styles.editArea}>
          <textarea
            className={styles.editTextarea}
            value={editing.proposedChange}
            rows={4}
            onChange={(e) => onEditChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
          <div className={styles.editActions}>
            <button
              type="button"
              className={styles.btnSave}
              onClick={(e) => {
                e.stopPropagation();
                onEditSave(editing.proposedChange);
              }}
            >
              Zapisz
            </button>
            <button
              type="button"
              className={styles.btnCancel}
              onClick={(e) => {
                e.stopPropagation();
                onEditCancel();
              }}
            >
              Anuluj
            </button>
          </div>
        </div>
      ) : (
        <p className={styles.proposedChange}>{hint.proposedChange}</p>
      )}

      {/* Actions */}
      {isPending && !editing && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnApply}
            onClick={(e) => {
              e.stopPropagation();
              onApply();
            }}
          >
            ✓ Wdróż
          </button>
          <button
            type="button"
            className={styles.btnEdit}
            onClick={(e) => {
              e.stopPropagation();
              onEditStart();
            }}
          >
            ✎ Edytuj
          </button>
          <button
            type="button"
            className={styles.btnDismiss}
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
          >
            ✕
          </button>
        </div>
      )}

      {isApplied && (
        <p className={styles.appliedLabel}>✓ Wdrożony</p>
      )}
    </article>
  );
}
