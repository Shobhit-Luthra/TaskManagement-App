import { describe, expect, it } from "vitest";
import { computeDropPosition } from "./compute-drop-position";

describe("computeDropPosition", () => {
  it("places a card between its neighbours", () => {
    expect(computeDropPosition(1000, 2000)).toBe(1500);
  });

  it("handles each edge and an empty column", () => {
    expect(computeDropPosition(null, 1000)).toBe(999);
    expect(computeDropPosition(1000, null)).toBe(1001);
    expect(computeDropPosition(null, null)).toBe(1000);
  });

  it("always returns a finite collision proposal", () => {
    expect(Number.isFinite(computeDropPosition(1000, 1000))).toBe(true);
  });
});
