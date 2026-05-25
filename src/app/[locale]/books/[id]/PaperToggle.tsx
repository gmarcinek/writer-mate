"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Minimap from "./Minimap";

type Format = "a4" | "a5";

const FORMATS: { id: Format; label: string; width: number; padding: string }[] = [
  { id: "a5", label: "A5", width: 600, padding: "48px 56px" },
  { id: "a4", label: "A4", width: 794, padding: "72px 80px" },
];

type HintSelectDetail = {
  fragment: string;
  startLine: number;
  endLine: number;
};

/** Find text nodes under root that together contain needle. Returns a DOM Range or null. */
function findTextRange(root: Element, needle: string): Range | null {
  if (!needle.trim()) return null;

  const trimmed = needle.trim().slice(0, 200); // cap to avoid expensive search

  // Build concatenated text + offsets map
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node as Text);

  let combined = "";
  const offsets: number[] = []; // start offset of each node in combined
  for (const n of nodes) {
    offsets.push(combined.length);
    combined += n.textContent ?? "";
  }

  const idx = combined.indexOf(trimmed);
  if (idx === -1) return null;

  const endIdx = idx + trimmed.length;

  // Find which nodes startLine and end fall in
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (let i = 0; i < nodes.length; i++) {
    const nodeStart = offsets[i];
    const nodeEnd = nodeStart + (nodes[i].textContent?.length ?? 0);

    if (!startNode && nodeEnd > idx) {
      startNode = nodes[i];
      startOffset = idx - nodeStart;
    }

    if (!endNode && nodeEnd >= endIdx) {
      endNode = nodes[i];
      endOffset = endIdx - nodeStart;
      break;
    }
  }

  if (!startNode || !endNode) return null;

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

export default function PaperToggle({
  title,
  content,
  showToolbar = true,
}: {
  title: string;
  content: string;
  showToolbar?: boolean;
}) {
  const [format, setFormat] = useState<Format>("a5");
  const fmt = FORMATS.find((f) => f.id === format)!;
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Respond to hint:select events from HintsPanel
  useEffect(() => {
    // Inject ::highlight(hint-highlight) style once
    const STYLE_ID = "hint-highlight-style";
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = "::highlight(hint-highlight) { background-color: rgba(255, 220, 50, 0.45); color: inherit; }";
      document.head.appendChild(style);
    }

    function onHintSelect(e: Event) {
      const { fragment } = (e as CustomEvent<HintSelectDetail>).detail;
      const contentEl = contentRef.current;
      const scrollEl = scrollRef.current;
      if (!contentEl || !scrollEl) return;

      // Clear previous highlights
      if (typeof CSS !== "undefined" && "highlights" in CSS) {
        CSS.highlights.delete("hint-highlight");
      }

      const range = findTextRange(contentEl, fragment);
      if (!range) return;

      // Apply CSS Custom Highlight API if available
      if (typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined") {
        CSS.highlights.set("hint-highlight", new Highlight(range));
      }

      // Scroll the start of the range into view
      try {
        const rect = range.getBoundingClientRect();
        const scrollRect = scrollEl.getBoundingClientRect();
        const relativeTop = rect.top - scrollRect.top + scrollEl.scrollTop;
        scrollEl.scrollTo({
          top: relativeTop - scrollRect.height / 3,
          behavior: "smooth",
        });
      } catch {
        // ignore scroll errors
      }
    }

    window.addEventListener("hint:select", onHintSelect);
    return () => {
      window.removeEventListener("hint:select", onHintSelect);
      if (typeof CSS !== "undefined" && "highlights" in CSS) {
        CSS.highlights.delete("hint-highlight");
      }
    };
  }, []);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {showToolbar ? (
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 16px",
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)", marginRight: "4px" }}>
            Format:
          </span>
          {FORMATS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFormat(f.id)}
              style={{
                padding: "4px 12px",
                fontSize: "12px",
                fontWeight: 500,
                borderRadius: "4px",
                border: format === f.id ? "1.5px solid var(--color-accent)" : "1.5px solid var(--color-border)",
                background: format === f.id ? "var(--color-accent)" : "transparent",
                color: format === f.id ? "#fff" : "var(--color-text-muted)",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Outer: does NOT scroll — minimap anchors here */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>

        {/* Inner: scrolls content, padded right so minimap doesnt overlap */}
        <div
          ref={scrollRef}
          style={{
            position: "absolute",
            inset: 0,
            overflowY: "auto",
            background: "var(--color-background)",
            paddingLeft: "96px",
            overflow: "hidden !important",
          }}
        >
          <div
            style={{
              minHeight: "100%",
              padding: "40px 24px 80px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div
              data-minimap-source
              style={{
                width: `${fmt.width}px`,
                maxWidth: "100%",
                background: "#fff",
                color: "#1a1a1a",
                padding: fmt.padding,
                boxShadow: "0 2px 8px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.08)",
                borderRadius: "2px",
                minHeight: "400px",
              }}
            >
              <h1
                style={{
                  fontSize: "20px",
                  fontWeight: 700,
                  lineHeight: 1.3,
                  marginBottom: "24px",
                  paddingBottom: "16px",
                  borderBottom: "1px solid #e5e5e5",
                  fontFamily: "Georgia, Times New Roman, serif",
                }}
              >
                {title}
              </h1>
              <section>
                <p
                  style={{
                    marginBottom: "14px",
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "#6b6b6b",
                    fontFamily: "ui-sans-serif, system-ui, sans-serif",
                  }}
                >
                  Content
                </p>
                <div
                  ref={contentRef}
                  data-minimap-content
                  style={{
                    fontSize: "15px",
                    lineHeight: "1.8",
                    fontFamily: "Georgia, Times New Roman, serif",
                    wordBreak: "break-word",
                  }}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h1: ({ node: _node, ...props }) => (
                        <h2
                          style={{
                            fontSize: "1.75rem",
                            lineHeight: 1.25,
                            margin: "0 0 1rem",
                            fontFamily: "Georgia, Times New Roman, serif",
                          }}
                          {...props}
                        />
                      ),
                      h2: ({ node: _node, ...props }) => (
                        <h3
                          style={{
                            fontSize: "1.375rem",
                            lineHeight: 1.3,
                            margin: "2rem 0 0.85rem",
                            fontFamily: "Georgia, Times New Roman, serif",
                          }}
                          {...props}
                        />
                      ),
                      h3: ({ node: _node, ...props }) => (
                        <h4
                          style={{
                            fontSize: "1.125rem",
                            lineHeight: 1.35,
                            margin: "1.5rem 0 0.75rem",
                            fontFamily: "Georgia, Times New Roman, serif",
                          }}
                          {...props}
                        />
                      ),
                      p: ({ node: _node, ...props }) => (
                        <p
                          style={{
                            margin: "0 0 1rem",
                            whiteSpace: "pre-wrap",
                            fontFamily: "Georgia, Times New Roman, serif",
                          }}
                          {...props}
                        />
                      ),
                      ul: ({ node: _node, ...props }) => (
                        <ul
                          style={{
                            margin: "0 0 1rem",
                            paddingLeft: "1.4rem",
                            fontFamily: "Georgia, Times New Roman, serif",
                          }}
                          {...props}
                        />
                      ),
                      ol: ({ node: _node, ...props }) => (
                        <ol
                          style={{
                            margin: "0 0 1rem",
                            paddingLeft: "1.4rem",
                            fontFamily: "Georgia, Times New Roman, serif",
                          }}
                          {...props}
                        />
                      ),
                      li: ({ node: _node, ...props }) => (
                        <li
                          style={{
                            marginBottom: "0.35rem",
                            fontFamily: "Georgia, Times New Roman, serif",
                          }}
                          {...props}
                        />
                      ),
                      blockquote: ({ node: _node, ...props }) => (
                        <blockquote
                          style={{
                            margin: "0 0 1rem",
                            paddingLeft: "1rem",
                            borderLeft: "3px solid #d6d6d6",
                            color: "#4a4a4a",
                            fontFamily: "Georgia, Times New Roman, serif",
                          }}
                          {...props}
                        />
                      ),
                      code: ({ node: _node, className, children, ...props }) => {
                        const inline = !className;

                        if (inline) {
                          return (
                            <code
                              style={{
                                fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                                background: "#f2f2f2",
                                borderRadius: "4px",
                                padding: "0.1rem 0.35rem",
                                fontSize: "0.92em",
                              }}
                              {...props}
                            >
                              {children}
                            </code>
                          );
                        }

                        return (
                          <code
                            className={className}
                            style={{
                              display: "block",
                              whiteSpace: "pre-wrap",
                              fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                              background: "#f6f6f6",
                              borderRadius: "8px",
                              padding: "0.9rem 1rem",
                              fontSize: "0.92em",
                            }}
                            {...props}
                          >
                            {children}
                          </code>
                        );
                      },
                      pre: ({ node: _node, ...props }) => (
                        <pre style={{ margin: "0 0 1rem" }} {...props} />
                      ),
                      hr: ({ node: _node, ...props }) => (
                        <hr style={{ margin: "1.5rem 0", border: 0, borderTop: "1px solid #e3e3e3" }} {...props} />
                      ),
                      table: ({ node: _node, ...props }) => (
                        <table
                          style={{
                            width: "100%",
                            borderCollapse: "collapse",
                            margin: "0 0 1rem",
                            fontFamily: "Georgia, Times New Roman, serif",
                          }}
                          {...props}
                        />
                      ),
                      img: ({ node: _node, src, alt, ...props }) => {
                        if (typeof src !== "string" || src.trim().length === 0) {
                          return null;
                        }

                        return (
                          <img
                            src={src}
                            alt={alt ?? ""}
                            style={{
                              display: "block",
                              maxWidth: "100%",
                              height: "auto",
                              margin: "0 0 1rem",
                            }}
                            {...props}
                          />
                        );
                      },
                      th: ({ node: _node, ...props }) => (
                        <th
                          style={{ border: "1px solid #dedede", padding: "0.55rem", textAlign: "left" }}
                          {...props}
                        />
                      ),
                      td: ({ node: _node, ...props }) => (
                        <td style={{ border: "1px solid #dedede", padding: "0.55rem" }} {...props} />
                      ),
                    }}
                  >
                    {content}
                  </ReactMarkdown>
                </div>
              </section>
            </div>
          </div>
        </div>

        {/* Minimap: absolute on outer wrapper — stays fixed while content scrolls */}
        <Minimap scrollContainerRef={scrollRef} />
      </div>
    </div>
  );
}