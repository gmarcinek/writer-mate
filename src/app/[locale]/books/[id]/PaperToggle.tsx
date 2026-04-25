"use client";

import { useState, useRef } from "react";
import Minimap from "./Minimap";

type Format = "a4" | "a5";

const FORMATS: { id: Format; label: string; width: number; padding: string }[] = [
  { id: "a5", label: "A5", width: 560, padding: "48px 56px" },
  { id: "a4", label: "A4", width: 794, padding: "72px 80px" },
];

export default function PaperToggle({
  title,
  content,
}: {
  title: string;
  content: string;
}) {
  const [format, setFormat] = useState<Format>("a5");
  const fmt = FORMATS.find((f) => f.id === format)!;
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Toolbar */}
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
            paddingRight: "96px",
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
              <div
                data-minimap-content
                style={{
                  fontSize: "15px",
                  lineHeight: "1.8",
                  fontFamily: "Georgia, Times New Roman, serif",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {content}
              </div>
            </div>
          </div>
        </div>

        {/* Minimap: absolute on outer wrapper — stays fixed while content scrolls */}
        <Minimap scrollContainerRef={scrollRef} />
      </div>
    </div>
  );
}