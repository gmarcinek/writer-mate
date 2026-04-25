export default function LayersPanel() {
  return (
    <section className="py-2">
      <p className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-text-muted)] px-2 pb-2">
        Warstwy analizy
      </p>
      <ul className="mt-1 space-y-1">
        {["Figury retoryczne"].map((name) => (
          <li key={name} className="text-xs px-2 py-1 rounded text-[var(--color-text-muted)] opacity-50 cursor-not-allowed">
            {name}
          </li>
        ))}
      </ul>
      <button
        disabled
        className="w-full px-2 py-1.5 border border-dashed border-[var(--color-border)] rounded text-xs text-[var(--color-text-muted)] cursor-not-allowed bg-transparent"
      >
        + Dodaj warstwę
      </button>
    </section>
  );
}
