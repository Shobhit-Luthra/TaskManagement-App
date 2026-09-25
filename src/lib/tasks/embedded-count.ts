export function embeddedCount(value: { count: number }[] | null | undefined): number {
  return value?.[0]?.count ?? 0;
}
