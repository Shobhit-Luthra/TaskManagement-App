/**
 * Proposes a fractional-index position from the cards immediately around a
 * drop. The database remains authoritative and repairs collisions.
 */
export function computeDropPosition(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return 1000;
  if (prev === null) return next! - 1;
  if (next === null) return prev + 1;
  return (prev + next) / 2;
}
