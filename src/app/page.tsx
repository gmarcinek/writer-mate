export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold" style={{ color: "var(--accent)" }}>
          Writer Mate
        </h1>
        <p className="text-lg" style={{ color: "var(--text-muted)" }}>
          Narzędzie edytorskie dla pisarzy — wspomagane przez LLM
        </p>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          🚧 W budowie
        </p>
      </div>
    </main>
  );
}
