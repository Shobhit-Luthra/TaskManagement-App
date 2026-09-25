import { expect, it } from "vitest";
import { embeddedCount } from "./embedded-count";

it("reads a PostgREST embedded count", () => {
  expect(embeddedCount([{ count: 3 }])).toBe(3);
  expect(embeddedCount([])).toBe(0);
  expect(embeddedCount(null)).toBe(0);
});
