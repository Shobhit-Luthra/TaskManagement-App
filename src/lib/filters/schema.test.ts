import { describe, expect, it } from "vitest";
import { EMPTY_FILTER_STATE, parseFilterState, serializeFilterState } from "./schema";

describe("filter URL schema", () => {
  it("uses the empty state without params", () =>
    expect(parseFilterState(new URLSearchParams())).toEqual(EMPTY_FILTER_STATE));
  it("parses valid values and omits unknown or malformed ones", () => {
    expect(
      parseFilterState(
        new URLSearchParams(
          "assignee=a1,a2&label=l1&priority=high,nope,urgent&due=today&q= launch &sort=title",
        ),
      ),
    ).toEqual({
      assignee: ["a1", "a2"],
      label: ["l1"],
      priority: ["high", "urgent"],
      due: "today",
      q: "launch",
    });
  });
  it("round-trips only non-default state", () => {
    const state = {
      ...EMPTY_FILTER_STATE,
      assignee: ["a1"],
      priority: ["high" as const],
      due: "week" as const,
      q: "bug",
    };
    expect(parseFilterState(serializeFilterState(state))).toEqual(state);
  });
});
