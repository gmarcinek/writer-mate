"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import type { ReaderSessionEvent } from "@/lib/reader/events";
import {
  ReaderSessionStatus,
  type ReaderCoverageRange,
  type ReaderCoverageSummary,
  type ReaderHandoff,
  type ReaderNote,
  type ReaderSession,
} from "@/lib/reader/types";
import styles from "./EntitiesPanel.module.scss";

type ReaderSessionArtifacts = {
  session: ReaderSession | null;
  notes: ReaderNote[];
  handoff: ReaderHandoff | null;
  coverage: ReaderCoverageRange[];
};

type CreateSessionResponse = {
  session: ReaderSession;
};

type EventLogCategory = "status" | "tool" | "thinking" | "note" | "handoff" | "error";

type EventLogItem = {
  id: string;
  category: EventLogCategory;
  timestamp: string;
  title: string;
  detail?: string;
};

const DEFAULT_PROMPT =
  "Przeczytaj te książkę dokładnie od początku do końca i przygotuj precyzyjne podsumowanie dla bieżącej wersji.";
const MODEL_OPTIONS = [
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 mini" },
];
const TERMINAL_STATUSES = new Set<ReaderSessionStatus>([
  ReaderSessionStatus.Complete,
  ReaderSessionStatus.Partial,
  ReaderSessionStatus.Failed,
  ReaderSessionStatus.Cancelled,
]);

function isTerminalStatus(status?: ReaderSessionStatus | null) {
  return status ? TERMINAL_STATUSES.has(status) : false;
}

function isBookPage(pathname: string) {
  return /^\/[a-z]{2}\/books\/[^/]+$/.test(pathname);
}

function formatTimestamp(value?: string | null) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

function formatPercent(value?: number) {
  if (typeof value !== "number") {
    return "-";
  }

  return `${Math.round(value)}%`;
}

function mergeCoverageRanges(
  current: ReaderCoverageRange[],
  incoming: ReaderCoverageRange[]
) {
  if (incoming.length === 0) {
    return current;
  }

  const deduped = new Map<string, ReaderCoverageRange>();

  [...current, ...incoming].forEach((range, index) => {
    const key = range.id
      ?? [
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

function truncateJson(value: unknown) {
  const text = JSON.stringify(value);

  if (!text) {
    return undefined;
  }

  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

function createLogItem(event: ReaderSessionEvent): EventLogItem | null {
  switch (event.type) {
    case "status":
      return {
        id: `${event.timestamp}-${event.type}-${event.status}`,
        category: "status",
        timestamp: event.timestamp,
        title: event.message,
        detail: `Status: ${event.status}`,
      };
    case "thinking":
      return {
        id: `${event.timestamp}-${event.type}-${event.stage}`,
        category: "thinking",
        timestamp: event.timestamp,
        title: event.message,
        detail: `Stage: ${event.stage}`,
      };
    case "tool_call":
      return {
        id: `${event.timestamp}-${event.type}-${event.toolName}`,
        category: "tool",
        timestamp: event.timestamp,
        title: `${event.toolName} called`,
        detail: truncateJson(event.input),
      };
    case "tool_result":
      return {
        id: `${event.timestamp}-${event.type}-${event.toolName}`,
        category: "tool",
        timestamp: event.timestamp,
        title: `${event.toolName} ${event.ok ? "completed" : "failed"}`,
        detail: event.ok ? truncateJson(event.result) : event.errorMessage,
      };
    case "note_saved":
      return {
        id: `${event.timestamp}-${event.type}-${event.noteId}`,
        category: "note",
        timestamp: event.timestamp,
        title: `Note ${event.ordinal + 1} saved`,
        detail: `Status: ${event.status}`,
      };
    case "handoff_ready":
      return {
        id: `${event.timestamp}-${event.type}-${event.handoffId}`,
        category: "handoff",
        timestamp: event.timestamp,
        title: "Final handoff ready",
        detail: event.executiveSummary,
      };
    case "error":
      return {
        id: `${event.timestamp}-${event.type}-${event.stage}`,
        category: "error",
        timestamp: event.timestamp,
        title: event.message,
        detail: `Stage: ${event.stage}`,
      };
    case "coverage":
      return null;
    default:
      return null;
  }
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

export default function EntitiesPanel() {
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();
  const bookId = typeof params.id === "string" ? params.id : null;
  const onBookPage = Boolean(bookId) && isBookPage(pathname);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [session, setSession] = useState<ReaderSession | null>(null);
  const [notes, setNotes] = useState<ReaderNote[]>([]);
  const [handoff, setHandoff] = useState<ReaderHandoff | null>(null);
  const [coverage, setCoverage] = useState<ReaderCoverageRange[]>([]);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [model, setModel] = useState(MODEL_OPTIONS[0]?.value ?? "gpt-4.1-mini");
  const [events, setEvents] = useState<EventLogItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!onBookPage || !bookId) {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setSession(null);
      setNotes([]);
      setHandoff(null);
      setCoverage([]);
      setEvents([]);
      setLoadError(null);
      setStreamError(null);
      setIsLoading(false);
      setIsSubmitting(false);
      setIsStreaming(false);
      return;
    }

    let cancelled = false;

    async function loadLatestSession() {
      setIsLoading(true);
      setLoadError(null);

      try {
        const response = await fetch(`/api/reader/books/${bookId}/session`, {
          cache: "no-store",
        });
        const data = await readJson<ReaderSessionArtifacts>(response);

        if (cancelled) {
          return;
        }

        setSession(data.session);
        setNotes(data.notes);
        setHandoff(data.handoff);
        setCoverage(data.coverage);
        setEvents([]);
        setPrompt(data.session?.goal.prompt ?? DEFAULT_PROMPT);

        if (data.session && bookId && !isTerminalStatus(data.session.status)) {
          openStream(data.session.id, model, bookId);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Failed to load reader session");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadLatestSession();

    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setIsStreaming(false);
    };
  }, [bookId, model, onBookPage]);

  async function refreshArtifacts(activeBookId: string) {
    const response = await fetch(`/api/reader/books/${activeBookId}/session`, {
      cache: "no-store",
    });
    const data = await readJson<ReaderSessionArtifacts>(response);
    setSession(data.session);
    setNotes(data.notes);
    setHandoff(data.handoff);
    setCoverage(data.coverage);
  }

  function appendEvent(event: ReaderSessionEvent) {
    const item = createLogItem(event);

    if (!item) {
      return;
    }

    setEvents((current) => [...current.slice(-79), item]);
  }

  function closeStream() {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setIsStreaming(false);
  }

  function openStream(sessionId: string, selectedModel: string, activeBookId: string) {
    closeStream();
    setStreamError(null);
    setIsStreaming(true);

    const url = new URL("/api/reader/sessions/stream", window.location.origin);
    url.searchParams.set("sessionId", sessionId);
    url.searchParams.set("model", selectedModel);

    const source = new EventSource(url);
    eventSourceRef.current = source;

    const handleEvent = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as ReaderSessionEvent;
      appendEvent(payload);

      if (payload.type === "status") {
        setSession((current) => {
          if (!current || current.id !== payload.sessionId) {
            return current;
          }

          return {
            ...current,
            status: payload.status,
          };
        });

        if (isTerminalStatus(payload.status)) {
          closeStream();
          void refreshArtifacts(activeBookId).catch((error) => {
            setStreamError(
              error instanceof Error ? error.message : "Failed to refresh reader artifacts"
            );
          });
        }

        return;
      }

      if (payload.type === "coverage") {
        setCoverage((current) => mergeCoverageRanges(current, toCoverageRanges(payload)));
      }
    };

    source.addEventListener("status", handleEvent as EventListener);
    source.addEventListener("thinking", handleEvent as EventListener);
    source.addEventListener("tool_call", handleEvent as EventListener);
    source.addEventListener("tool_result", handleEvent as EventListener);
    source.addEventListener("note_saved", handleEvent as EventListener);
    source.addEventListener("handoff_ready", handleEvent as EventListener);
    source.addEventListener("coverage", handleEvent as EventListener);
    source.addEventListener("error", ((event: Event) => {
      if (event instanceof MessageEvent && typeof event.data === "string" && event.data.length > 0) {
        handleEvent(event);
        return;
      }

      setStreamError("Reader stream disconnected.");
      closeStream();
    }) as EventListener);
  }

  async function handleStartSession() {
    if (!bookId) {
      return;
    }

    setIsSubmitting(true);
    setLoadError(null);
    setStreamError(null);
    setEvents([]);

    try {
      const response = await fetch(`/api/reader/books/${bookId}/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
      });
      const data = await readJson<CreateSessionResponse>(response);
      setSession(data.session);
      setNotes([]);
      setHandoff(null);
      setCoverage([]);
      openStream(data.session.id, model, bookId);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to create reader session");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!onBookPage) {
    return (
      <section className={styles.emptyState}>
        <p className={styles.eyebrow}>Reader</p>
        <h2 className={styles.emptyTitle}>Open a book to inspect a reader session.</h2>
        <p className={styles.emptyCopy}>
          The workbench appears only on book routes and stays out of the way elsewhere.
        </p>
      </section>
    );
  }

  const coverageSummary: ReaderCoverageSummary | undefined =
    handoff?.coverageSummary ?? session?.coverageSummary;
  const sessionLabel = session && !isTerminalStatus(session.status) ? "Current session" : "Last session";
  const conversationItems = [
    ...events.map((event) => ({
      id: event.id,
      kind: "event" as const,
      category: event.category,
      timestamp: event.timestamp,
      title: event.title,
      detail: event.detail,
    })),
    ...(handoff
      ? [
          {
            id: `handoff-${handoff.id}`,
            kind: "handoff" as const,
            category: "handoff" as const,
            timestamp: handoff.createdAt,
            title: "Final handoff",
            detail: handoff.executiveSummary,
          },
        ]
      : []),
  ].sort((left, right) => left.timestamp.localeCompare(right.timestamp));

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Reader</p>
          <h2 className={styles.title}>Workbench</h2>
        </div>
        <div
          className={styles.statusBadge}
          data-status={(session?.status ?? "idle").toLowerCase()}
        >
          {isStreaming ? "live" : session?.status ?? "idle"}
        </div>
      </header>

      <section className={styles.sessionSummary}>
        {session ? (
          <>
            <span>{sessionLabel}</span>
            <span>{session.id.slice(0, 8)}</span>
            <span>{notes.length} notes</span>
            <span>{formatPercent(coverageSummary?.readPercent)} coverage</span>
            <span>{formatTimestamp(session.updatedAt)}</span>
          </>
        ) : (
          <span className={styles.subtle}>No reader session exists for this book yet.</span>
        )}
      </section>

      <section className={styles.composer}>
        <label className={styles.field}>
          <span>Model</span>
          <select
            className={styles.select}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            disabled={isStreaming || isSubmitting}
          >
            {MODEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Reader prompt</span>
          <textarea
            className={styles.textarea}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={6}
            disabled={isSubmitting}
          />
        </label>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={handleStartSession}
            disabled={isSubmitting || isStreaming || prompt.trim().length === 0}
          >
            {isSubmitting ? "Starting..." : isStreaming ? "Reader running" : "Start reader"}
          </button>
          {session && bookId && !isTerminalStatus(session.status) && !isStreaming ? (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => openStream(session.id, model, bookId)}
            >
              Resume live
            </button>
          ) : null}
        </div>
        {loadError ? <p className={styles.errorText}>{loadError}</p> : null}
        {streamError ? <p className={styles.errorText}>{streamError}</p> : null}
        {isLoading ? <p className={styles.subtle}>Loading latest session...</p> : null}
      </section>

      <section className={styles.chatThread}>
        {conversationItems.length > 0 ? (
          <ol className={styles.chatList}>
            {conversationItems.map((item) => (
              <li
                key={item.id}
                className={styles.chatMessage}
                data-kind={item.kind}
                data-category={item.category}
              >
                <div className={styles.chatMetaRow}>
                  <span className={styles.eventCategory} data-category={item.category}>
                    {item.category}
                  </span>
                  <time className={styles.eventTimestamp}>{formatTimestamp(item.timestamp)}</time>
                </div>
                <p className={styles.eventTitle}>{item.title}</p>
                {item.detail ? (
                  <pre className={styles.eventDetail} data-category={item.category}>
                    {item.detail}
                  </pre>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.subtle}>Start or resume a reader session to see streaming updates in the workbench thread.</p>
        )}
      </section>
    </section>
  );
}
