import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThroughputChart } from "./throughput-chart";

describe("ThroughputChart", () => {
  it("shows the insufficient-data card with fewer than 2 weeks of data", () => {
    render(<ThroughputChart data={[{ weekStart: "2026-09-01", completedCount: 4 }]} />);
    expect(screen.getByText(/at least 2 weeks/i)).toBeInTheDocument();
  });

  it("renders a text summary of total completions once there is enough data", () => {
    render(
      <ThroughputChart
        data={[
          { weekStart: "2026-08-25", completedCount: 4 },
          { weekStart: "2026-09-01", completedCount: 6 },
        ]}
      />,
    );
    expect(screen.getByText(/10 tasks completed/i)).toBeInTheDocument();
  });
});
