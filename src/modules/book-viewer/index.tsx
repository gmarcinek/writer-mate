export default function BookViewer() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 select-none">
      <span className="text-5xl opacity-20">📖</span>
      <p className="text-sm text-[var(--color-text-muted)]">
        Wybierz projekt z biblioteki
      </p>
      <p className="text-xs text-[var(--color-text-muted)] opacity-60">
        lub utwórz nowy klikając + Nowy projekt
      </p>
    </div>
  );
}
