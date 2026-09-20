export function StatTile({
  label,
  value,
  sampleSize,
}: {
  label: string;
  value: string;
  sampleSize?: number;
}) {
  return (
    <div className="bg-card rounded-xl border p-4">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sampleSize !== undefined && (
        <p className="text-muted-foreground mt-1 text-xs">n={sampleSize}</p>
      )}
    </div>
  );
}
