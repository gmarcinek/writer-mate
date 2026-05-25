"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import type { ReaderSessionEvent } from "@/lib/reader/events";
import {
  ReaderSessionStatus,
  type ReaderCoverageRange,
  type ReaderHandoff,
  type ReaderMasterHandoff,
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

type LayersResponse = {
  sessions: ReaderSession[];
  masterHandoff: ReaderMasterHandoff | null;
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
  const expandedLayerIdRef = useRef<string | null>(null);

  const [layers, setLayers] = useState<ReaderSession[]>([]);
  const [masterHandoff, setMasterHandoff] = useState<ReaderMasterHandoff | null>(null);
  const [masterHandoffExpanded, setMasterHandoffExpanded] = useState(false);
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null);
  const [expandedArtifacts, setExpandedArtifacts] = useState<ReaderSessionArtifacts | null>(null);
  const [expandedArtifactsLoading, setExpandedArtifactsLoading] = useState(false);
  const [streamingLayerId, setStreamingLayerId] = useState<string | null>(null);
  const [events, setEvents] = useState<EventLogItem[]>([]);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(() => new Set());
  const [artifactsDrawerOpen, setArtifactsDrawerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Keep ref in sync with state so closures always have current value
  expandedLayerIdRef.current = expandedLayerId;

  function setExpandedLayerIdSynced(id: string | null) {
    expandedLayerIdRef.current = id;
    setExpandedLayerId(id);
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, []);

  // Load layers when bookId changes
  useEffect(() => {
    if (!onBookPage || !bookId) {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setLayers([]);
      setMasterHandoff(null);
      setExpandedLayerIdSynced(null);
      setExpandedArtifacts(null);
      setStreamingLayerId(null);
      setEvents([]);
      setLoadError(null);
      setStreamError(null);
      setIsLoading(false);
      setIsSubmitting(false);
      return;
    }

    let cancelled = false;

    async function loadLayers() {
      setIsLoading(true);
      setLoadError(null);

      try {
        const response = await fetch(`/api/reader/books/${bookId}/sessions`, {
          cache: "no-store",
        });
        const data = await readJson<LayersResponse>(response);

        if (cancelled) return;

        setLayers(data.sessions);
        setMasterHandoff(data.masterHandoff);
        setEvents([]);

        const activeSession = data.sessions.find((s) => !isTerminalStatus(s.status));

        if (activeSession) {
          setStreamingLayerId(activeSession.id);
          setExpandedLayerIdSynced(activeSession.id);
          openStream(activeSession.id, 'gpt-5.5', bookId!);
        } else if (data.sessions.length > 0 && data.sessions[0]) {
          setExpandedLayerIdSynced(data.sessions[0].id);
          void fetchAndSetArtifacts(data.sessions[0].id);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Failed to load reading layers");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadLayers();

    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setStreamingLayerId(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, onBookPage]);

  async function fetchAndSetArtifacts(sessionId: string) {
    setExpandedArtifactsLoading(true);
    try {
      const response = await fetch(`/api/reader/sessions/${sessionId}`, {
        cache: "no-store",
      });
      const artifacts = await readJson<ReaderSessionArtifacts>(response);
      setExpandedArtifacts(artifacts);
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : "Failed to load session artifacts");
    } finally {
      setExpandedArtifactsLoading(false);
    }
  }

  async function refreshLayers(activeBookId: string, finishedSessionId: string) {
    const response = await fetch(`/api/reader/books/${activeBookId}/sessions`, {
      cache: "no-store",
    });
    const data = await readJson<LayersResponse>(response);
    setLayers(data.sessions);
    setMasterHandoff(data.masterHandoff);

    if (expandedLayerIdRef.current === finishedSessionId) {
      void fetchAndSetArtifacts(finishedSessionId);
    }
  }

  function appendEvent(event: ReaderSessionEvent) {
    const item = createLogItem(event);
    if (!item) return;
    setEvents((current) => [...current.slice(-79), item]);
  }

  function closeStream() {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setStreamingLayerId(null);
  }

  function openStream(sessionId: string, selectedModel: string, activeBookId: string) {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setStreamError(null);
    setStreamingLayerId(sessionId);

    const url = new URL("/api/reader/sessions/stream", window.location.origin);
    url.searchParams.set("sessionId", sessionId);
    url.searchParams.set("model", selectedModel);

    const source = new EventSource(url);
    eventSourceRef.current = source;

    const handleEvent = (rawEvent: MessageEvent<string>) => {
      const payload = JSON.parse(rawEvent.data) as ReaderSessionEvent;
      appendEvent(payload);

      if (payload.type === "status") {
        setLayers((current) =>
          current.map((layer) =>
            layer.id === payload.sessionId ? { ...layer, status: payload.status } : layer
          )
        );

        if (isTerminalStatus(payload.status)) {
          closeStream();
          void refreshLayers(activeBookId, sessionId).catch((error) => {
            setStreamError(
              error instanceof Error ? error.message : "Failed to refresh reading layers"
            );
          });
        }

        return;
      }

      if (payload.type === "coverage") {
        // Coverage stored per-layer; not accumulated in panel state
        return;
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
        handleEvent(event as MessageEvent<string>);
        return;
      }

      setStreamError("Reader stream disconnected.");
      closeStream();
    }) as EventListener);
  }

  async function handleToggleLayer(layerId: string) {
    if (expandedLayerId === layerId) {
      setExpandedLayerIdSynced(null);
      setExpandedArtifacts(null);
      return;
    }

    setExpandedLayerIdSynced(layerId);
    setExpandedArtifacts(null);
    await fetchAndSetArtifacts(layerId);
  }

  function toggleThinking(layerId: string) {
    setExpandedThinking((current) => {
      const next = new Set(current);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
        if (expandedLayerId !== layerId) {
          setExpandedLayerIdSynced(layerId);
          void fetchAndSetArtifacts(layerId);
        }
      }
      return next;
    });
  }

  async function handleStartSession() {
    if (!bookId) return;

    setIsSubmitting(true);
    setLoadError(null);
    setStreamError(null);
    setEvents([]);

    try {
      const response = await fetch(`/api/reader/books/${bookId}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await readJson<CreateSessionResponse>(response);

      setLayers((current) => [data.session, ...current]);
      setExpandedLayerIdSynced(data.session.id);
      setExpandedArtifacts(null);
      openStream(data.session.id, 'gpt-5.5', bookId);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to create reading session");
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

  return (
    <section className={styles.panel}>
      <header className={styles.workbenchHeader}>
        <div>
          <p className={styles.eyebrow}>Reader</p>
          <h2 className={styles.title}>Workbench</h2>
        </div>
        <div className={styles.headerActions}>
          {isLoading && <span className={styles.subtle}>Ładowanie...</span>}
          {layers.length > 0 && (
            <button
              type="button"
              className={styles.artifactsButton}
              onClick={() => {
                if (!expandedArtifacts && expandedLayerId) {
                  void fetchAndSetArtifacts(expandedLayerId);
                }
                setArtifactsDrawerOpen(true);
              }}
              title="Pokaż artefakty"
            >
              ◧ Artefakty
            </button>
          )}
        </div>
      </header>

      <div className={styles.chatArea}>
        {masterHandoff && (
          <div className={styles.masterHandoffBubble}>
            <button
              type="button"
              onClick={() => setMasterHandoffExpanded((v) => !v)}
            >
              📚 Master Handoff [{masterHandoff.sessionCount} warstw] {masterHandoffExpanded ? "▲" : "▼"}
            </button>
            {masterHandoffExpanded && (
              <div className={styles.masterHandoffDetail}>
                <p>{masterHandoff.executiveSummary}</p>
              </div>
            )}
          </div>
        )}

        {layers.map((layer) => (
          <div key={layer.id} className={styles.conversationPair}>
            {/* USER BUBBLE */}
            <div className={styles.userBubble}>
              <p className={styles.bubbleText}>{layer.goal.prompt}</p>
              <time className={styles.bubbleTime}>{formatTimestamp(layer.createdAt)}</time>
            </div>

            {/* ASSISTANT BUBBLE */}
            <div className={styles.assistantBubble}>
              {/* Thinking toggle */}
              <button
                type="button"
                className={styles.thinkingToggle}
                onClick={() => toggleThinking(layer.id)}
              >
                <span className={styles.thinkingIcon}>🧠</span>
                {streamingLayerId === layer.id
                  ? `Process ⟳ ${events.length} events`
                  : expandedArtifacts && expandedLayerId === layer.id
                    ? `Reading ⟳ ${expandedArtifacts.notes.length} notatek`
                    : "Process"
                }
                <span className={styles.thinkingArrow}>
                  {expandedThinking.has(layer.id) ? "▲" : "▼"}
                </span>
              </button>

              {/* Thinking content */}
              {expandedThinking.has(layer.id) && (
                <div className={styles.thinkingContent}>
                  {streamingLayerId === layer.id ? (
                    <ol className={styles.eventList}>
                      {events.map((event) => (
                        <li key={event.id} className={styles.eventItem} data-category={event.category}>
                          <span className={styles.eventLabel}>{event.category}</span>
                          <span className={styles.eventText}>{event.title}</span>
                        </li>
                      ))}
                    </ol>
                  ) : expandedArtifactsLoading && expandedLayerId === layer.id ? (
                    <p className={styles.loadingText}>Ładowanie...</p>
                  ) : expandedArtifacts && expandedLayerId === layer.id ? (
                    <div className={styles.artifactsSummary}>
                      <p className={styles.artifactsSummaryLine}>
                        {expandedArtifacts.notes.length} notatek · status: {layer.status}
                      </p>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Final answer */}
              <div className={styles.finalAnswer}>
                {streamingLayerId === layer.id ? (
                  <p className={styles.streamingAnswer}>
                    {events.filter((e) => e.category === "status").at(-1)?.title ?? "Trwa czytanie..."}
                  </p>
                ) : expandedArtifactsLoading && expandedLayerId === layer.id ? (
                  <p className={styles.loadingText}>Ładowanie...</p>
                ) : expandedArtifacts?.handoff && expandedLayerId === layer.id ? (
                  <p className={styles.finalAnswerText}>
                    {expandedArtifacts.handoff.executiveSummary}
                  </p>
                ) : !isTerminalStatus(layer.status) ? (
                  <p className={styles.loadingText}>Oczekuje na zakończenie...</p>
                ) : expandedArtifacts && expandedLayerId === layer.id && !expandedArtifacts.handoff ? (
                  <p className={styles.loadingText}>Sesja zakończona bez pełnej analizy.</p>
                ) : layer.id === expandedLayerId ? null : (
                  <button
                    type="button"
                    className={styles.loadLayerButton}
                    onClick={() => void handleToggleLayer(layer.id)}
                  >
                    Pokaż wyniki →
                  </button>
                )}
              </div>

              {/* Error */}
              {streamingLayerId === layer.id && streamError && (
                <p className={styles.errorText}>{streamError}</p>
              )}
            </div>
          </div>
        ))}

        {layers.length === 0 && !isLoading && (
          <div className={styles.emptyChat}>
            <p>Brak warstw czytania. Dodaj pierwsze czytanie.</p>
          </div>
        )}
      </div>

      <div className={styles.inputArea}>
        {loadError && <p className={styles.errorText}>{loadError}</p>}
        <div className={styles.inputWrap}>
          <textarea
            className={styles.promptInput}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Cel czytania..."
            rows={2}
            disabled={isSubmitting || Boolean(streamingLayerId)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleStartSession();
              }
            }}
          />
          <button
            type="button"
            className={styles.sendButton}
            onClick={() => void handleStartSession()}
            disabled={isSubmitting || prompt.trim().length === 0 || Boolean(streamingLayerId)}
          >
            {isSubmitting ? "..." : "^"}
          </button>
        </div>
      </div>

      {artifactsDrawerOpen && expandedArtifacts && (
        <div className={styles.drawer}>
          <div className={styles.drawerOverlay} onClick={() => setArtifactsDrawerOpen(false)} />
          <div className={styles.drawerPanel}>
            <div className={styles.drawerHeader}>
              <h3>Artefakty</h3>
              <button
                type="button"
                className={styles.drawerClose}
                onClick={() => setArtifactsDrawerOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className={styles.drawerBody}>
              {expandedArtifacts.notes.map((note, i) => (
                <div key={note.id} className={styles.drawerNote}>
                  <h4>Note {i + 1}</h4>
                  <p>{note.summary}</p>
                  {note.facts.length > 0 && (
                    <ul>{note.facts.map((f, fi) => <li key={fi}>{f}</li>)}</ul>
                  )}
                </div>
              ))}
              {expandedArtifacts.handoff && (
                <div className={styles.drawerHandoff}>
                  <h4>Final Handoff</h4>
                  <p>{expandedArtifacts.handoff.executiveSummary}</p>
                  {expandedArtifacts.handoff.conclusions.map((c, i) => (
                    <div key={i}>[{c.statementKind}] <strong>{c.title}</strong>: {c.summary}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
