"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/modules/sidebar";

export default function WorkspaceShell({
  projectsContent,
  settingsContent,
  main,
  rightPanel,
  hintsPanel,
}: {
  projectsContent: React.ReactNode;
  settingsContent: React.ReactNode;
  main: React.ReactNode;
  rightPanel: React.ReactNode;
  hintsPanel?: React.ReactNode;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [hintsHasData, setHintsHasData] = useState(false);
  const pathname = usePathname();
  const hideSidebar = /^\/[a-z]{2}\/books\/[^/]+$/.test(pathname);
  const hintsOpen = hideSidebar && Boolean(hintsPanel) && hintsHasData;

  useEffect(() => {
    function onHintsUpdated(e: Event) {
      const { count } = (e as CustomEvent<{ count: number }>).detail;
      setHintsHasData(count > 0);
    }
    window.addEventListener("hints:updated", onHintsUpdated);
    return () => window.removeEventListener("hints:updated", onHintsUpdated);
  }, []);

  return (
    <div
      className="app-shell"
      data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
      data-sidebar-hidden={hideSidebar ? "true" : "false"}
      data-hints-open={hintsOpen ? "true" : "false"}
    >
      {!hideSidebar ? (
        <aside className="app-shell-left border-r border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          <Sidebar
            projectsContent={projectsContent}
            settingsContent={settingsContent}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
          />
        </aside>
      ) : null}
      <main className="app-shell-main">{main}</main>
      {hintsOpen && hintsPanel ? (
        <aside
          className={[
            "app-shell-hints bg-[var(--color-surface)] overflow-hidden",
            "border-l border-[var(--color-border)]",
          ].join(" ")}
        >
          {hintsPanel}
        </aside>
      ) : null}
      <aside
        className={[
          "app-shell-right bg-[var(--color-surface)] overflow-hidden",
          "border-l border-[var(--color-border)]",
        ].join(" ")}
      >
        {rightPanel}
      </aside>
    </div>
  );
}