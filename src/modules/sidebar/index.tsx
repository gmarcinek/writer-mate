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
}: {
  projectsContent: React.ReactNode;
  settingsContent: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("projects");
  const [modalOpen, setModalOpen] = useState(false);

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
                borderRadius: "6px",
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
