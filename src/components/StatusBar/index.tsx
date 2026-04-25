import { getTranslations } from "next-intl/server";

export default async function StatusBar() {
  const t = await getTranslations("StatusBar");
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
      <span style={{ fontSize: "11px", color: "var(--color-header-muted)" }}>{t("ready")}</span>
      <span style={{ fontSize: "11px", color: "var(--color-header-muted)" }}>v0.1.0</span>
    </div>
  );
}
