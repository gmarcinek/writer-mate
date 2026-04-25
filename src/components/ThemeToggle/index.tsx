"use client";

import { useState, useEffect } from "react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const current = document.documentElement.dataset.theme as "light" | "dark";
    setTheme(current ?? "light");
  }, []);

  async function toggle() {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    await fetch("/api/theme", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: next }),
    });
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="text-[--color-text-muted] hover:text-[--color-foreground] transition-colors px-2 py-1 rounded text-sm"
    >
      {theme === "light" ? "🌙" : "☀️"}
    </button>
  );
}
