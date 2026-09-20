import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CumulativeFlowChart } from "./cumulative-flow-chart";

const rows = [
  { snapshotDate: "2026-09-01", columnId: "c1", columnName: "To Do", taskCount: 5 },
  // 2026-09-02 intentionally missing — a gap, not an interpolated value.
  { snapshotDate: "2026-09-03", columnId: "c1", columnName: "To Do", taskCount: 3 },
];

describe("CumulativeFlowChart", () => {
  it("renders an accessible text summary alongside the chart", () => {
    render(<CumulativeFlowChart data={rows} />);
    expect(screen.getByText(/gap on 2026-09-02/i)).toBeInTheDocument();
  });
});
