import { getTranslations } from "next-intl/server";
import ThemeToggle from "@/components/ThemeToggle";

export default async function AppBar() {
  const t = await getTranslations("AppBar");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: "0 20px",
        background: "var(--color-header-bg)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ color: "var(--color-accent)", fontSize: "18px", lineHeight: 1 }}>✦</span>
        <span
          style={{
            fontSize: "15px",
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: "var(--color-header-fg)",
          }}
        >
          {t("title")}
        </span>
      </div>
      <ThemeToggle />
    </div>
  );
}
