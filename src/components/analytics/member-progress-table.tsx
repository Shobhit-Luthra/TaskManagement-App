"use client";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

export type MemberProgressRow = {
  memberUserId: string | null;
  displayName: string;
  role: string | null;
  openCount: number;
  inProgressCount: number;
  completedInPeriod: number;
  overdueCount: number;
  dueSoonCount: number;
};

type SortKey =
  | "displayName"
  | "openCount"
  | "inProgressCount"
  | "completedInPeriod"
  | "overdueCount"
  | "dueSoonCount";

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "displayName", label: "Member", numeric: false },
  { key: "openCount", label: "Open", numeric: true },
  { key: "inProgressCount", label: "In progress", numeric: true },
  { key: "completedInPeriod", label: "Done (30 days)", numeric: true },
  { key: "overdueCount", label: "Overdue", numeric: true },
  { key: "dueSoonCount", label: "Due in 7 days", numeric: true },
];

/** Sorts members; the Unassigned row always stays last. */
export function sortMemberRows(
  rows: MemberProgressRow[],
  key: SortKey,
  direction: "asc" | "desc",
): MemberProgressRow[] {
  const members = rows.filter((row) => row.memberUserId !== null);
  const unassigned = rows.filter((row) => row.memberUserId === null);
  const sign = direction === "asc" ? 1 : -1;
  members.sort((a, b) => {
    const result =
      key === "displayName"
        ? a.displayName.localeCompare(b.displayName)
        : (a[key] as number) - (b[key] as number);
    return result === 0 ? a.displayName.localeCompare(b.displayName) : result * sign;
  });
  return [...members, ...unassigned];
}

export function MemberProgressTable({ rows }: { rows: MemberProgressRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("openCount");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const sorted = useMemo(
    () => sortMemberRows(rows, sortKey, direction),
    [rows, sortKey, direction],
  );
  const maxOpen = Math.max(1, ...rows.map((row) => row.openCount));

  function toggle(key: SortKey) {
    if (key === sortKey) setDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDirection(key === "displayName" ? "asc" : "desc");
    }
  }

  return (
    <section aria-labelledby="member-progress-heading" className="bg-card rounded-xl border p-5">
      <h2 id="member-progress-heading" className="text-sm font-semibold">
        Progress by member
      </h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left text-xs">
              {COLUMNS.map((column) => {
                const active = column.key === sortKey;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
                    className={
                      column.numeric ? "px-2 py-2 text-right font-medium" : "py-2 pr-2 font-medium"
                    }
                  >
                    <button
                      type="button"
                      onClick={() => toggle(column.key)}
                      className="hover:text-foreground inline-flex items-center gap-1"
                    >
                      {column.label}
                      {active &&
                        (direction === "asc" ? (
                          <ArrowUp className="size-3" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="size-3" aria-hidden="true" />
                        ))}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.memberUserId ?? "unassigned"} className="border-b last:border-0">
                <th scope="row" className="py-2 pr-2 text-left font-medium">
                  <span className={row.memberUserId === null ? "text-muted-foreground italic" : ""}>
                    {row.displayName}
                  </span>
                  {row.role && (
                    <span className="text-muted-foreground ml-2 text-xs capitalize">
                      {row.role}
                    </span>
                  )}
                </th>
                <td className="px-2 py-2 text-right tabular-nums">
                  <div className="flex items-center justify-end gap-2">
                    <span
                      aria-hidden="true"
                      className="bg-muted hidden h-1.5 w-16 overflow-hidden rounded-full sm:block"
                    >
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${(row.openCount / maxOpen) * 100}%`,
                          background: "var(--color-chart-2)",
                        }}
                      />
                    </span>
                    {row.openCount}
                  </div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{row.inProgressCount}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.completedInPeriod}</td>
                <td
                  className={
                    row.overdueCount > 0
                      ? "text-destructive px-2 py-2 text-right font-medium tabular-nums"
                      : "px-2 py-2 text-right tabular-nums"
                  }
                >
                  {row.overdueCount}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{row.dueSoonCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
