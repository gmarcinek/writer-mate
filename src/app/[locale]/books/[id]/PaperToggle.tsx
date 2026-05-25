"use client";

import { useEffect, useRef, useState } from "react";
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
                    fontSize: "14px",
                    lineHeight: "1.8",
                    fontFamily: "Georgia, Times New Roman, serif",
                    wordBreak: "break-word",
                  }}
                >
                  {content.split("\n").map((line, i) => (
                    <div key={i} style={{ display: "flex", gap: "14px", minHeight: "1.8em" }}>
                      <span
                        style={{
                          width: "42px",
                          flexShrink: 0,
                          textAlign: "right",
                          color: "#c0c0c0",
                          fontSize: "10px",
                          fontFamily: "ui-monospace, SFMono-Regular, monospace",
                          lineHeight: "1.8",
                          userSelect: "none",
                        }}
                      >
                        {i + 1}
                      </span>
                      <span style={{ flex: 1, whiteSpace: "pre-wrap", lineHeight: "1.8" }}>
                        {line}
                      </span>
                    </div>
                  ))}

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