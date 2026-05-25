"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/modules/sidebar";

export default function WorkspaceShell({
  projectsContent,
  settingsContent,
  main,
  rightPanel,
}: {
  projectsContent: React.ReactNode;
  settingsContent: React.ReactNode;
  main: React.ReactNode;
  rightPanel: React.ReactNode;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const pathname = usePathname();
  const hideSidebar = /^\/[a-z]{2}\/books\/[^/]+$/.test(pathname);

  return (
    <div
      className="app-shell"
      data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
      data-sidebar-hidden={hideSidebar ? "true" : "false"}
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