export default function EntitiesPanel() {
  return (
    <section className="py-2">
      <p className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-text-muted)] px-2 pb-2">
        Encje
      </p>
      <ul className="mt-1 space-y-1">
        {["Encja #1", "Encja #2", "Encja #3"].map((name) => (
          <li key={name} className="text-xs px-2 py-1 rounded text-[var(--color-text-muted)] opacity-50">
            {name}
          </li>
        ))}
      </ul>
    </section>
  );
}
