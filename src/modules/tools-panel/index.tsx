import UploadBook from "./UploadBook";

export default function ToolsPanel() {
  return (
    <section className="flex flex-col gap-3 py-2">
      <p className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-text-muted)] px-2">
        Narzędzia
      </p>
      <UploadBook />
    </section>
  );
}
