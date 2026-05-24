"use client";

import { useState } from "react";
import NewProjectModal from "./NewProjectModal";

type Tab = "projects" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "projects", label: "Projekty" },
  { id: "settings", label: "Ustawienia" },
];

export default function Sidebar({
  projectsContent,
  settingsContent,
  collapsed = false,
  onToggleCollapsed,
}: {
  projectsContent: React.ReactNode;
  settingsContent: React.ReactNode;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("projects");
  const [modalOpen, setModalOpen] = useState(false);

  if (collapsed) {
    return (
      <div className="flex flex-col h-full items-center" style={{ padding: "12px 8px", gap: "12px" }}>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Rozwiń panel boczny"
          style={{
            width: "100%",
            padding: "10px 0",
            borderRadius: "4px",
            border: "1px solid var(--color-border)",
            background: "transparent",
            color: "var(--color-foreground)",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          »
        </button>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          aria-label="Nowy projekt"
          style={{
            width: "100%",
            padding: "10px 0",
            borderRadius: "4px",
            border: "none",
            background: "var(--color-accent)",
            color: "#fff",
            cursor: "pointer",
            fontSize: "16px",
            fontWeight: 700,
          }}
        >
          +
        </button>
        <div className="flex flex-col gap-2 w-full">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              title={label}
              aria-label={label}
              style={{
                width: "100%",
                padding: "10px 0",
                borderRadius: "4px",
                border: tab === id ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
                background: tab === id ? "color-mix(in srgb, var(--color-accent) 12%, transparent)" : "transparent",
                color: tab === id ? "var(--color-accent)" : "var(--color-text-muted)",
                cursor: "pointer",
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {label.slice(0, 1)}
            </button>
          ))}
        </div>
        {modalOpen && <NewProjectModal onClose={() => setModalOpen(false)} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div
        className="flex shrink-0"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              flex: 1,
              padding: "12px 0",
              fontSize: "13px",
              fontWeight: tab === id ? 600 : 400,
              color: tab === id ? "var(--color-accent)" : "var(--color-text-muted)",
              background: "transparent",
              border: "none",
              borderBottom: tab === id ? "2px solid var(--color-accent)" : "2px solid transparent",
              marginBottom: "-1px",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Zwiń panel boczny"
          style={{
            padding: "12px 14px",
            fontSize: "14px",
            color: "var(--color-text-muted)",
            background: "transparent",
            border: "none",
            borderLeft: "1px solid var(--color-border)",
            cursor: "pointer",
          }}
        >
          «
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "16px 12px" }}>
        {tab === "projects" && (
          <div className="flex flex-col gap-4">
            <button
              onClick={() => setModalOpen(true)}
              style={{
                width: "100%",
                padding: "10px 16px",
                background: "var(--color-accent)",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "background 0.15s",
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = "var(--color-accent-dim)")}
              onMouseOut={(e) => (e.currentTarget.style.background = "var(--color-accent)")}
            >
              + Nowy projekt
            </button>
            {projectsContent}
          </div>
        )}
        {tab === "settings" && (
          <div style={{ padding: "8px 0" }}>{settingsContent}</div>
        )}
      </div>

      {modalOpen && <NewProjectModal onClose={() => setModalOpen(false)} />}
    </div>
  );
}
