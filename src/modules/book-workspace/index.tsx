"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PaperToggle from "@/app/[locale]/books/[id]/PaperToggle";
import type { ReaderSessionEvent } from "@/lib/reader/events";
import {
  ReaderSessionStatus,
  type ReaderCoverageRange,
  type ReaderCoverageSummary,
  type ReaderHandoff,
  type ReaderHandoffStatus,
  type ReaderNote,
  type ReaderSession,
} from "@/lib/reader/types";
import styles from "./BookWorkspace.module.scss";

type ReaderSessionArtifacts = {
  session: ReaderSession | null;
  notes: ReaderNote[];
  handoff: ReaderHandoff | null;
  coverage: ReaderCoverageRange[];
};

type BookWorkspaceProps = {
  bookId: string;
  locale: string;
  books: Array<{ id: string; title: string }>;
  title: string;
  content: string;
};

type SelectedArtifact =
  | { kind: "handoff" }
  | { kind: "note"; noteId: string }
  | null;

type WorkingArtifact =
  | {
      id: string;
      kind: "handoff";
      title: string;
      status: ReaderHandoffStatus;
      updatedAt: string;
      handoff: ReaderHandoff;
    }
  | {
      id: string;
      kind: "note";
      title: string;
      status: ReaderNote["status"];
      updatedAt: string;
      note: ReaderNote;
    };

const TERMINAL_STATUSES = new Set<ReaderSessionStatus>([
  ReaderSessionStatus.Complete,
  ReaderSessionStatus.Partial,
  ReaderSessionStatus.Failed,
  ReaderSessionStatus.Cancelled,
]);

function isTerminalStatus(status?: ReaderSessionStatus | null) {
  return status ? TERMINAL_STATUSES.has(status) : false;
}

function mergeCoverageRanges(current: ReaderCoverageRange[], incoming: ReaderCoverageRange[]) {
  if (incoming.length === 0) {
    return current;
  }

  const deduped = new Map<string, ReaderCoverageRange>();

  [...current, ...incoming].forEach((range, index) => {
    const key =
      range.id ??
      [
        range.sessionId,
        range.noteId ?? "note:none",
        range.handoffId ?? "handoff:none",
        range.disposition,
        range.reason,
        range.startLine,
        range.endLine,
        range.recordedAt ?? `idx:${index}`,
      ].join(":");

    deduped.set(key, range);
  });

  return Array.from(deduped.values()).sort((left, right) => {
    if (left.startLine !== right.startLine) {
      return left.startLine - right.startLine;
    }

    const leftTime = left.recordedAt ?? "";
    const rightTime = right.recordedAt ?? "";

    return leftTime.localeCompare(rightTime);
  });
}

function toCoverageRanges(event: Extract<ReaderSessionEvent, { type: "coverage" }>): ReaderCoverageRange[] {
  return event.coverage.map((range, index) => ({
    ...range,
    sessionId: event.sessionId,
    noteId: event.noteId ?? null,
    handoffId: null,
    id: `${event.sessionId}:${event.timestamp}:${range.startLine}-${range.endLine}:${index}`,
  }));
}

function formatTimestamp(value?: string | null) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

async function readJson<TResponse>(response: Response): Promise<TResponse> {
  const json = (await response.json()) as TResponse & {
    error?: string;
    message?: string;
  };

  if (!response.ok) {
    throw new Error(json.message ?? json.error ?? "Request failed");
  }

  return json;
}

function renderStringList(items: string[], emptyMessage: string) {
  if (items.length === 0) {
    return <p className={styles.emptyInline}>{emptyMessage}</p>;
  }

  return (
    <ul className={styles.list}>
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

function renderCoverageSummary(coverageSummary?: ReaderCoverageSummary) {
  if (!coverageSummary) {
    return <p className={styles.emptyInline}>Coverage details will appear after the reader saves progress.</p>;
  }

  return (
    <dl className={styles.metaGrid}>
      <div>
        <dt>Read</dt>
        <dd>{coverageSummary.readPercent}%</dd>
      </div>
      <div>
        <dt>Visited</dt>
        <dd>{coverageSummary.visitedPercent}%</dd>
      </div>
      <div>
        <dt>Read lines</dt>
        <dd>{coverageSummary.readLines}</dd>
      </div>
      <div>
        <dt>Open gaps</dt>
        <dd>{coverageSummary.gapRanges.length}</dd>
      </div>
    </dl>
  );
}

function formatArtifactTimestamp(value: string) {
  return formatTimestamp(value);
}

function buildWorkingArtifacts(handoff: ReaderHandoff | null, notes: ReaderNote[]): WorkingArtifact[] {
  const artifacts: WorkingArtifact[] = notes
    .slice()
    .sort((left, right) => {
      const timeCompare = right.updatedAt.localeCompare(left.updatedAt);

      if (timeCompare !== 0) {
        return timeCompare;
      }

      return right.ordinal - left.ordinal;
    })
    .map((note) => ({
      id: `note:${note.id}`,
      kind: "note",
      title: `Note ${note.ordinal}`,
      status: note.status,
      updatedAt: note.updatedAt,
      note,
    }));

  if (handoff) {
    artifacts.unshift({
      id: `handoff:${handoff.id}`,
      kind: "handoff",
      title: "Final handoff",
      status: handoff.status,
      updatedAt: handoff.createdAt,
      handoff,
    });
  }

  return artifacts;
}

function resolveSelection(previous: SelectedArtifact, nextArtifacts: ReaderSessionArtifacts): SelectedArtifact {
  if (previous?.kind === "handoff" && nextArtifacts.handoff) {
    return previous;
  }

  if (previous?.kind === "note") {
    const stillExists = nextArtifacts.notes.some((note) => note.id === previous.noteId);

    if (stillExists) {
      return previous;
    }
  }

  if (nextArtifacts.handoff) {
    return { kind: "handoff" };
  }

  const latestNote = nextArtifacts.notes
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

  return latestNote ? { kind: "note", noteId: latestNote.id } : null;
}

function renderNoteDetail(note: ReaderNote) {
  return (
    <div className={styles.detailStack}>
      <section className={styles.previewSection}>
        <h4 className={styles.sectionLabel}>Summary</h4>
        <p className={styles.previewText}>{note.summary}</p>
      </section>

      <section className={styles.previewSection}>
        <h4 className={styles.sectionLabel}>Facts</h4>
        {renderStringList(note.facts, "No facts were captured in this note.")}
      </section>

      <section className={styles.previewSection}>
        <h4 className={styles.sectionLabel}>Inferences</h4>
        {renderStringList(note.inferences, "No inferences were captured in this note.")}
      </section>

      <section className={styles.previewSection}>
        <h4 className={styles.sectionLabel}>Open questions</h4>
        {renderStringList(note.unresolvedQuestions, "No unresolved questions were recorded.")}
      </section>

      <section className={styles.previewSection}>
        <h4 className={styles.sectionLabel}>Follow-up actions</h4>
        {renderStringList(note.followUpActions, "No follow-up actions were recorded.")}
      </section>
    </div>
  );
}

function renderHandoffDetail(handoff: ReaderHandoff) {
  return (
    <div className={styles.detailStack}>
      <section className={styles.previewSection}>
        <h4 className={styles.sectionLabel}>Executive summary</h4>
        <p className={styles.previewText}>{handoff.executiveSummary}</p>
      </section>

      <section className={styles.previewSection}>
        <h4 className={styles.sectionLabel}>Conclusions</h4>
        {renderStringList(
          handoff.conclusions.map((item) => `${item.title}: ${item.summary}`),
          "No conclusions were captured in the final handoff."
        )}
      </section>

      <section className={styles.previewSection}>
        <h4 className={styles.sectionLabel}>Gaps</h4>
        {renderStringList(handoff.gaps, "No open gaps remain in the current handoff.")}
      </section>

      <section className={styles.previewSection}>
        <h4 className={styles.sectionLabel}>Next questions</h4>
        {renderStringList(handoff.nextQuestions, "No follow-up questions were recorded.")}
      </section>

      <section className={styles.previewSection}>
        <h4 className={styles.sectionLabel}>Caveats and limitations</h4>
        {renderStringList(
          [...handoff.caveats, ...handoff.limitations],
          "No caveats or limitations were recorded."
        )}
      </section>
    </div>
  );
}

export default function BookWorkspace({ bookId, locale, books, title, content }: BookWorkspaceProps) {
  const router = useRouter();
  const [artifacts, setArtifacts] = useState<ReaderSessionArtifacts | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<SelectedArtifact>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  async function refreshArtifacts(activeBookId: string, signal?: AbortSignal) {
    const response = await fetch(`/api/reader/books/${activeBookId}/session`, {
      signal,
      cache: "no-store",
    });
    const data = await readJson<ReaderSessionArtifacts>(response);

    setArtifacts(data);
    setSelectedArtifact((current) => resolveSelection(current, data));

    return data;
  }

  function closeStream() {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setIsStreaming(false);
  }

  function openStream(sessionId: string, activeBookId: string) {
    closeStream();
    setStreamError(null);
    setIsStreaming(true);

    const url = new URL("/api/reader/sessions/stream", window.location.origin);
    url.searchParams.set("sessionId", sessionId);

    const source = new EventSource(url);
    eventSourceRef.current = source;

    const handleEvent = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as ReaderSessionEvent;

      if (payload.type === "status") {
        setArtifacts((current) => {
          if (!current?.session || current.session.id !== payload.sessionId) {
            return current;
          }

          return {
            ...current,
            session: {
              ...current.session,
              status: payload.status,
              updatedAt: payload.timestamp,
            },
          };
        });

        if (isTerminalStatus(payload.status)) {
          closeStream();
          void refreshArtifacts(activeBookId).catch((refreshError) => {
            setStreamError(
              refreshError instanceof Error ? refreshError.message : "Failed to refresh reader artifacts"
            );
          });
        }

        return;
      }

      if (payload.type === "coverage") {
        setArtifacts((current) => {
          if (!current || current.session?.id !== payload.sessionId) {
            return current;
          }

          return {
            ...current,
            coverage: mergeCoverageRanges(current.coverage, toCoverageRanges(payload)),
          };
        });
        return;
      }

      if (payload.type === "note_saved" || payload.type === "handoff_ready") {
        void refreshArtifacts(activeBookId).catch((refreshError) => {
          setStreamError(
            refreshError instanceof Error ? refreshError.message : "Failed to refresh reader artifacts"
          );
        });
      }
    };

    source.addEventListener("status", handleEvent as EventListener);
    source.addEventListener("coverage", handleEvent as EventListener);
    source.addEventListener("note_saved", handleEvent as EventListener);
    source.addEventListener("handoff_ready", handleEvent as EventListener);
    source.addEventListener(
      "error",
      ((event: Event) => {
        if (event instanceof MessageEvent && typeof event.data === "string" && event.data.length > 0) {
          handleEvent(event);
          return;
        }

        setStreamError("Reader stream disconnected.");
        closeStream();
      }) as EventListener
    );
  }

  useEffect(() => {
    const controller = new AbortController();

    async function loadArtifacts() {
      setIsLoading(true);
      setError(null);
      setStreamError(null);

      try {
        const data = await refreshArtifacts(bookId, controller.signal);

        if (!controller.signal.aborted && data.session && !isTerminalStatus(data.session.status)) {
          openStream(data.session.id, bookId);
        }
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "Failed to load reader artifacts");
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadArtifacts();

    return () => {
      controller.abort();
      closeStream();
    };
  }, [bookId]);

  const handoff = artifacts?.handoff ?? null;
  const session = artifacts?.session ?? null;
  const notes = artifacts?.notes ?? [];
  const coverageSummary = handoff?.coverageSummary ?? session?.coverageSummary;
  const workingArtifacts = buildWorkingArtifacts(handoff, notes);
  const selectedItem =
    selectedArtifact?.kind === "handoff"
      ? handoff
        ? { kind: "handoff" as const, title: "Final handoff", status: handoff.status, updatedAt: handoff.createdAt, handoff }
        : null
      : selectedArtifact?.kind === "note"
        ? (() => {
            const selectedNote = notes.find((note) => note.id === selectedArtifact.noteId);

            return selectedNote
              ? {
                  kind: "note" as const,
                  title: `Note ${selectedNote.ordinal}`,
                  status: selectedNote.status,
                  updatedAt: selectedNote.updatedAt,
                  note: selectedNote,
                }
              : null;
          })()
        : null;

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
        <div className={styles.topMeta}>
          {session ? <span className={styles.inlineMeta}>Session {session.id.slice(0, 8)}</span> : null}
          <span className={styles.statusBadge}>{isStreaming ? "live" : session?.status ?? "idle"}</span>
        </div>
      </header>

      <div className={styles.contentGrid}>
        <div className={styles.sourcePane}>
          {content ? (
            <PaperToggle title={title} content={content} showToolbar={false} />
          ) : (
            <div className={styles.emptyState}>
              <p>Brak treści</p>
            </div>
          )}
        </div>

        <aside className={styles.previewPane}>
          <div className={styles.previewHeader}>
            <div>
              <span className={styles.topLabel}>Preview</span>
              <strong className={styles.detailTitle}>{selectedItem?.title ?? "No artifact selected"}</strong>
            </div>
            {selectedItem ? (
              <span className={styles.detailMeta}>
                {selectedItem.status} · {formatArtifactTimestamp(selectedItem.updatedAt)}
              </span>
            ) : null}
          </div>

          <div className={styles.previewBody}>
            {selectedItem ? (
              selectedItem.kind === "handoff"
                ? renderHandoffDetail(selectedItem.handoff)
                : renderNoteDetail(selectedItem.note)
            ) : session ? (
              <div className={styles.previewFallback}>
                <p className={styles.previewText}>No persisted handoff or note is selected yet.</p>
                {renderCoverageSummary(coverageSummary)}
              </div>
            ) : (
              <p className={styles.muted}>Choose a project artifact to open it next to the source.</p>
            )}
          </div>
        </aside>

        <nav className={styles.artifactMenu}>
          <div className={styles.menuHeader}>
            <span className={styles.topLabel}>Artifacts</span>
            <span className={styles.menuCount}>{workingArtifacts.length}</span>
          </div>
          {isLoading ? <p className={styles.menuEmpty}>Loading artifacts...</p> : null}
          {error ? <p className={styles.error}>{error}</p> : null}
          {streamError ? <p className={styles.error}>{streamError}</p> : null}
          {workingArtifacts.length > 0 ? (
            <div className={styles.workingFilesList}>
              {workingArtifacts.map((artifact) => {
                const isSelected =
                  artifact.kind === "handoff"
                    ? selectedArtifact?.kind === "handoff"
                    : selectedArtifact?.kind === "note" && selectedArtifact.noteId === artifact.note.id;

                return (
                  <button
                    key={artifact.id}
                    type="button"
                    className={styles.fileButton}
                    data-selected={isSelected ? "true" : "false"}
                    onClick={() => {
                      if (artifact.kind === "handoff") {
                        setSelectedArtifact({ kind: "handoff" });
                        return;
                      }

                      setSelectedArtifact({ kind: "note", noteId: artifact.note.id });
                    }}
                  >
                    <span className={styles.fileButtonTitle}>{artifact.title}</span>
                    <span className={styles.fileButtonMeta}>{artifact.status}</span>
                    <span className={styles.fileButtonTimestamp}>{formatArtifactTimestamp(artifact.updatedAt)}</span>
                  </button>
                );
              })}
            </div>
          ) : !isLoading && !error ? (
            <p className={styles.menuEmpty}>No artifacts yet.</p>
          ) : null}
        </nav>
      </div>
    </section>
  );
}
