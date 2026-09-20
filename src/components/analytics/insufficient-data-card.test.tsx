import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsufficientDataCard } from "./insufficient-data-card";

describe("InsufficientDataCard", () => {
  it("renders a message naming the minimum window", () => {
    render(<InsufficientDataCard minWeeks={2} />);
    expect(screen.getByText(/at least 2 weeks/i)).toBeInTheDocument();
  });
});
