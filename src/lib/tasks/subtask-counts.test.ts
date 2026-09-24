import { expect, it } from "vitest";
import { subtaskCounts } from "./subtask-counts";

it("counts completed and total subtasks", () => {
  expect(
    subtaskCounts([{ is_completed: true }, { is_completed: false }, { is_completed: true }]),
  ).toEqual({ subtask_done: 2, subtask_total: 3 });
  expect(subtaskCounts(null)).toEqual({ subtask_done: 0, subtask_total: 0 });
});
