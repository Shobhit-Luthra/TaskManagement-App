export function todayInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function addDaysToDateString(date: string, days: number): string {
  const [year = 0, month = 0, day = 0] = date.split("-").map(Number);
  const midnight = new Date(Date.UTC(year, month - 1, day));
  midnight.setUTCDate(midnight.getUTCDate() + days);
  return midnight.toISOString().slice(0, 10);
}
