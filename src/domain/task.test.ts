import { describe, expect, it } from "vitest";

import {
  DEFAULT_TASK_PRIORITY,
  DEFAULT_TASK_SOURCE,
  DEFAULT_TASK_STATUS,
  TASK_PRIORITIES,
  TASK_SOURCES,
  TASK_STATUSES,
  isTaskPriority,
  isTaskSource,
  isTaskStatus,
  isTerminalTaskStatus,
  taskPriorityLabel,
  taskSourceLabel,
  taskStatusLabel,
} from "./task";

describe("task constants", () => {
  it("ships open/completed, low/medium/high, and manual/rule without recurrence", () => {
    expect(TASK_STATUSES.map((item) => item.value)).toEqual([
      "open",
      "completed",
    ]);
    expect(TASK_PRIORITIES.map((item) => item.value)).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(TASK_SOURCES.map((item) => item.value)).toEqual(["manual", "rule"]);
    expect(DEFAULT_TASK_STATUS).toBe("open");
    expect(DEFAULT_TASK_PRIORITY).toBe("medium");
    expect(DEFAULT_TASK_SOURCE).toBe("manual");
    expect(isTaskStatus("open")).toBe(true);
    expect(isTaskPriority("urgent")).toBe(false);
    expect(isTaskSource("manual")).toBe(true);
    expect(isTerminalTaskStatus("completed")).toBe(true);
    expect(isTerminalTaskStatus("open")).toBe(false);
    expect(taskStatusLabel("completed")).toBe("Completed");
    expect(taskPriorityLabel("high")).toBe("High");
    expect(taskSourceLabel("rule")).toBe("Rule");
  });
});
