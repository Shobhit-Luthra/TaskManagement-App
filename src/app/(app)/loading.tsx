export default function AppLoading() {
  return (
    <main className="mx-auto max-w-6xl animate-pulse px-6 py-10">
      <p className="text-muted-foreground text-sm">Loading your workspace…</p>
      <div className="bg-muted mt-4 h-8 w-64 rounded" />
      <div className="mt-10 flex gap-4 overflow-hidden">
        {[0, 1, 2].map((column) => (
          <section key={column} className="bg-card w-72 shrink-0 rounded-xl border p-4">
            <div className="bg-muted h-5 w-24 rounded" />
            <div className="mt-6 space-y-3">
              <div className="bg-muted h-20 rounded-lg" />
              <div className="bg-muted h-20 rounded-lg" />
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
