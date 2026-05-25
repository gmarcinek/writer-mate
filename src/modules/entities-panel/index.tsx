"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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

type EventLogCategory = "status" | "tool" | "thinking" | "note" | "handoff" | "error" | "intent";

type EventLogItem = {
  id: string;
  category: EventLogCategory;
  timestamp: string;
  title: string;
  detail?: string;
};

const INTENT_LABELS: Record<string, string> = {
  exhaustive_read: "Pełne czytanie",
  question_answering: "Odpowiedź na pytanie",
  targeted_extraction: "Ekstrakcja danych",
  analysis: "Analiza tematyczna",
  structure_survey: "Rozpoznanie struktury",
};

const TOOL_LABELS: Record<string, string> = {
  readLines: "Czyta linie",
  skipLines: "Pomija linie",
  jumpToLine: "Skacze do linii",
  jumpToGap: "Szuka luki w pokryciu",
  searchPhrases: "Szuka fraz",
  saveNotes: "Zapisuje notatkę",
  finish: "Zamyka sesję",
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
    case "answer_chunk":
      return null;
    case "intent_recognized":
      return {
        id: `${event.timestamp}-${event.type}`,
        category: "intent",
        timestamp: event.timestamp,
        title: `Intencja: ${event.strategicGoal}`,
        detail: event.intentType,
      };
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
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const [layers, setLayers] = useState<ReaderSession[]>([]);
  const [masterHandoff, setMasterHandoff] = useState<ReaderMasterHandoff | null>(null);
  const [masterHandoffExpanded, setMasterHandoffExpanded] = useState(false);
  const [layerArtifacts, setLayerArtifacts] = useState<Record<string, ReaderSessionArtifacts>>({});
  const [artifactsLoadingIds, setArtifactsLoadingIds] = useState<Set<string>>(() => new Set());
  const [streamingLayerId, setStreamingLayerId] = useState<string | null>(null);
  const [layerEvents, setLayerEvents] = useState<Record<string, EventLogItem[]>>({});
  const [layerAnswers, setLayerAnswers] = useState<Record<string, string>>({});
  const [layerAnswerStreaming, setLayerAnswerStreaming] = useState<Record<string, boolean>>({});
  const [prompt, setPrompt] = useState("");
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(() => new Set());
  const [artifactsDrawerOpen, setArtifactsDrawerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [layerIntents, setLayerIntents] = useState<Record<string, { intentType: string; strategicGoal: string; intermediateGoals: string[] }>>({});
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const [activePickerSessionId, setActivePickerSessionId] = useState<string | null>(null);

  function scrollToSession(sessionId: string) {
    const chatArea = chatAreaRef.current;
    if (!chatArea) return;
    const el = chatArea.querySelector<HTMLElement>(`[data-session-id="${sessionId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setActivePickerSessionId(sessionId);
  }

  function focusNewConversation() {
    promptRef.current?.focus();
    chatAreaRef.current?.scrollTo({ top: chatAreaRef.current.scrollHeight, behavior: "smooth" });
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
      setLayerArtifacts({});
      setArtifactsLoadingIds(new Set());
      setStreamingLayerId(null);
      setLayerEvents({});
      setLayerAnswers({});
      setLayerAnswerStreaming({});
      setLayerIntents({});
      setActiveToolName(null);
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

        const reversed = [...data.sessions].reverse();
        setLayers(reversed);
        setMasterHandoff(data.masterHandoff);

        const activeSession = reversed.find((s) => !isTerminalStatus(s.status));
        if (activeSession) {
          openStream(activeSession.id, 'gpt-5.5', bookId!);
        }

        for (const session of reversed) {
          if (isTerminalStatus(session.status)) {
            void fetchAndSetArtifacts(session.id);
          }
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
    setArtifactsLoadingIds((prev) => new Set([...prev, sessionId]));
    try {
      const response = await fetch(`/api/reader/sessions/${sessionId}`, {
        cache: "no-store",
      });
      const artifacts = await readJson<ReaderSessionArtifacts>(response);
      setLayerArtifacts((prev) => ({ ...prev, [sessionId]: artifacts }));
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : "Failed to load session artifacts");
    } finally {
      setArtifactsLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  }

  async function refreshLayers(activeBookId: string, finishedSessionId: string) {
    const response = await fetch(`/api/reader/books/${activeBookId}/sessions`, {
      cache: "no-store",
    });
    const data = await readJson<LayersResponse>(response);
    setLayers([...data.sessions].reverse());
    setMasterHandoff(data.masterHandoff);
    void fetchAndSetArtifacts(finishedSessionId);
  }

  function appendEvent(event: ReaderSessionEvent) {
    const item = createLogItem(event);
    if (!item) return;
    setLayerEvents((current) => {
      const prev = current[event.sessionId] ?? [];
      return { ...current, [event.sessionId]: [...prev.slice(-79), item] };
    });
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
    setLayerEvents((prev) => ({ ...prev, [sessionId]: [] }));
    setLayerAnswers((prev) => ({ ...prev, [sessionId]: "" }));
    setLayerAnswerStreaming((prev) => ({ ...prev, [sessionId]: false }));
    setActiveToolName(null);

    // Auto-expand thinking section for the new stream
    setExpandedThinking((current) => {
      const next = new Set(current);
      next.add(sessionId);
      return next;
    });

    const url = new URL("/api/reader/sessions/stream", window.location.origin);
    url.searchParams.set("sessionId", sessionId);
    url.searchParams.set("model", selectedModel);

    const source = new EventSource(url);
    eventSourceRef.current = source;

    const handleEvent = (rawEvent: MessageEvent<string>) => {
      const payload = JSON.parse(rawEvent.data) as ReaderSessionEvent;
      appendEvent(payload);

      if (payload.type === "intent_recognized") {
        setLayerIntents((prev) => ({
          ...prev,
          [payload.sessionId]: {
            intentType: payload.intentType,
            strategicGoal: payload.strategicGoal,
            intermediateGoals: payload.intermediateGoals,
          },
        }));
        return;
      }

      if (payload.type === "tool_call") {
        setActiveToolName(payload.toolName);
      }
      if (payload.type === "tool_result") {
        setActiveToolName(null);
      }

      if (payload.type === "answer_chunk") {
        if (payload.done) {
          setLayerAnswerStreaming((prev) => ({ ...prev, [sessionId]: false }));
        } else {
          setLayerAnswerStreaming((prev) => ({ ...prev, [sessionId]: true }));
          setLayerAnswers((prev) => ({ ...prev, [sessionId]: (prev[sessionId] ?? "") + payload.text }));
        }
        return;
      }

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

    source.addEventListener("intent_recognized", handleEvent as EventListener);
    source.addEventListener("answer_chunk", handleEvent as EventListener);
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

  function toggleThinking(layerId: string) {
    setExpandedThinking((current) => {
      const next = new Set(current);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
      }
      return next;
    });
  }

  async function handleStartSession() {
    if (!bookId) return;

    setIsSubmitting(true);
    setLoadError(null);
    setStreamError(null);

    try {
      const response = await fetch(`/api/reader/books/${bookId}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await readJson<CreateSessionResponse>(response);

      setLayers((current) => [...current, data.session]);
      openStream(data.session.id, 'gpt-5.5', bookId);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to create reading session");
    } finally {
      setIsSubmitting(false);
    }
  }

  const lineCount = prompt.split("\n").length;
  const textareaRows = Math.min(Math.max(lineCount, 1), 20);
  const drawerSessionId = streamingLayerId ?? layers[layers.length - 1]?.id ?? null;
  const drawerArtifacts = drawerSessionId ? (layerArtifacts[drawerSessionId] ?? null) : null;

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
              onClick={() => setArtifactsDrawerOpen(true)}
              title="Pokaż artefakty"
            >
              ◧ Artefakty
            </button>
          )}
        </div>
      </header>

      {/* Conversation picker */}
      {layers.length > 0 && (
        <div className={styles.convPicker}>
          <div className={styles.convPickerList}>
            {layers.map((layer, idx) => (
              <button
                key={layer.id}
                type="button"
                className={[
                  styles.convPickerChip,
                  (activePickerSessionId ?? layers[layers.length - 1]?.id) === layer.id
                    ? styles.convPickerChipActive
                    : "",
                  streamingLayerId === layer.id ? styles.convPickerChipStreaming : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => scrollToSession(layer.id)}
                title={layer.goal.prompt}
              >
                {idx + 1}. {layer.goal.prompt.slice(0, 28)}{layer.goal.prompt.length > 28 ? "…" : ""}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.newConvButton}
            onClick={focusNewConversation}
            title="Nowa konwersacja"
          >
            ＋
          </button>
        </div>
      )}

      <div ref={chatAreaRef} className={styles.chatArea}>
        <div className={styles.conversationList}>
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
          <Fragment key={layer.id}>
            {/* USER MESSAGE */}
            <div data-session-id={layer.id} className={styles.userBubble}>
              <p className={styles.bubbleText}>{layer.goal.prompt}</p>
              <time className={styles.bubbleTime}>{formatTimestamp(layer.createdAt)}</time>
            </div>

            {/* ASSISTANT */}
            <div className={styles.assistantWrapper}>
              <time className={styles.assistantMeta}>{formatTimestamp(layer.createdAt)}</time>

              {/* STATUS BUBBLE — ephemeral, collapsible */}
              <div className={styles.assistantBubble}>
                {layerIntents[layer.id] && (
                  <div className={styles.intentBadge}>
                    <span className={styles.intentTypeChip}>
                      {INTENT_LABELS[layerIntents[layer.id].intentType] ?? layerIntents[layer.id].intentType}
                    </span>
                    <span className={styles.intentGoal}>{layerIntents[layer.id].strategicGoal}</span>
                  </div>
                )}
                <button
                  type="button"
                  className={styles.thinkingToggle}
                  onClick={() => toggleThinking(layer.id)}
                >
                  <span className={styles.thinkingIcon}>🧠</span>
                  {streamingLayerId === layer.id
                    ? `${(layerEvents[layer.id] ?? []).length} zdarzeń`
                    : layerArtifacts[layer.id]
                      ? `${layerArtifacts[layer.id].notes.length} notatek`
                      : "Proces"
                  }
                  <span className={styles.thinkingArrow}>
                    {expandedThinking.has(layer.id) ? "▲" : "▼"}
                  </span>
                </button>
                {expandedThinking.has(layer.id) && (
                  <div className={styles.thinkingContent}>
                    {(streamingLayerId === layer.id || layerEvents[layer.id] !== undefined) ? (
                      <ol className={styles.eventList}>
                        {(layerEvents[layer.id] ?? []).map((event, i) => (
                          <li key={`${event.id}-${i}`} className={styles.eventItem} data-category={event.category}>
                            <span className={styles.eventLabel}>{event.category}</span>
                            <span className={styles.eventText}>{event.title}</span>
                          </li>
                        ))}
                        {activeToolName && streamingLayerId === layer.id && (
                          <li className={styles.eventItem} data-category="tool">
                            <span className={styles.eventLabel}>tool</span>
                            <span className={styles.eventText}>
                              {TOOL_LABELS[activeToolName] ?? activeToolName}
                              <span className={styles.animDots} />
                            </span>
                          </li>
                        )}
                      </ol>
                    ) : artifactsLoadingIds.has(layer.id) ? (
                      <p className={styles.loadingText}>Ładowanie...</p>
                    ) : layerArtifacts[layer.id] ? (
                      <div className={styles.artifactsSummary}>
                        <p className={styles.artifactsSummaryLine}>
                          {layerArtifacts[layer.id].notes.length} notatek · status: {layer.status}
                        </p>
                      </div>
                    ) : null}
                  </div>
                )}
                {streamingLayerId === layer.id && streamError && (
                  <p className={styles.errorText}>{streamError}</p>
                )}
              </div>

              {/* ANSWER BUBBLE — always visible */}
              <div className={styles.answerBubble}>
                {layerAnswers[layer.id] ? (
                  <div className={styles.finalAnswerText}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{layerAnswers[layer.id]}</ReactMarkdown>
                    {layerAnswerStreaming[layer.id] && <span className={styles.streamingCursor}> ▮</span>}
                  </div>
                ) : streamingLayerId === layer.id ? (
                  <p className={styles.streamingAnswer}>
                    {(layerEvents[layer.id] ?? []).filter((e) => e.category === "status").at(-1)?.title ?? "Trwa czytanie..."}
                  </p>
                ) : !isTerminalStatus(layer.status) ? (
                  <p className={styles.loadingText}>Oczekuje na zakończenie...</p>
                ) : artifactsLoadingIds.has(layer.id) ? (
                  <p className={styles.loadingText}>Ładowanie odpowiedzi...</p>
                ) : layerArtifacts[layer.id]?.handoff ? (
                  <div className={styles.finalAnswerText}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{layerArtifacts[layer.id].handoff!.executiveSummary}</ReactMarkdown>
                  </div>
                ) : layerArtifacts[layer.id] ? (
                  <p className={styles.loadingText}>Sesja zakończona bez pełnej analizy.</p>
                ) : null}
              </div>
            </div>
          </Fragment>
        ))}

        {layers.length === 0 && !isLoading && (
          <div className={styles.emptyChat}>
            <p>Brak warstw czytania. Dodaj pierwsze czytanie.</p>
          </div>
        )}
        </div>

        <div className={styles.floatingInput}>
          {loadError && <p className={styles.errorText}>{loadError}</p>}
          <div className={styles.inputWrap}>
            <textarea
              className={`${styles.promptInput}${lineCount <= 1 ? ` ${styles.promptInputCentered}` : ""}`}
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Co analizujemy? Wprowadź cel czytania, pytanie lub instrukcję dla czytelnika..."
              rows={textareaRows}
              disabled={isSubmitting || Boolean(streamingLayerId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  if (lineCount <= 1) {
                    e.preventDefault();
                    void handleStartSession();
                  }
                }
              }}
            />
            <button
              type="button"
              className={styles.sendButton}
              onClick={() => void handleStartSession()}
              disabled={isSubmitting || prompt.trim().length === 0 || Boolean(streamingLayerId)}
            >
              {isSubmitting ? "Wysyłanie..." : "Wyślij"}
            </button>
          </div>
        </div>
      </div>

      {artifactsDrawerOpen && drawerArtifacts && (
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
              {drawerArtifacts.notes.map((note, i) => (
                <div key={note.id} className={styles.drawerNote}>
                  <h4>Note {i + 1}</h4>
                  <p>{note.summary}</p>
                  {note.facts.length > 0 && (
                    <ul>{note.facts.map((f, fi) => <li key={fi}>{f}</li>)}</ul>
                  )}
                </div>
              ))}
              {drawerArtifacts.handoff && (
                <div className={styles.drawerHandoff}>
                  <h4>Final Handoff</h4>
                  <p>{drawerArtifacts.handoff.executiveSummary}</p>
                  {drawerArtifacts.handoff.conclusions.map((c, i) => (
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
