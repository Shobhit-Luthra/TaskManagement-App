export function InsufficientDataCard({ minWeeks }: { minWeeks: number }) {
  return (
    <div className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
      Not enough history yet. This chart needs at least {minWeeks} weeks of activity — check back
      once the project has been running a while longer.
    </div>
  );
}
