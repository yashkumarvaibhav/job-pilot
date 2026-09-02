import { describe, expect, it } from "vitest";

import {
  dueSourceKey,
  derivedDueItemTitle,
  parseDueSourceKey,
  reschedulePreservesKey,
} from "./due-source";

describe("due-source keys", () => {
  it("is the only provenance definition and never includes the calendar day", () => {
    expect(dueSourceKey("contact_next_action", "rahul")).toBe(
      "contact:rahul:next_action",
    );
    expect(dueSourceKey("company_next_action", "microsoft")).toBe(
      "company:microsoft:next_action",
    );
    expect(dueSourceKey("opportunity_next_action", "ms-sde")).toBe(
      "opportunity:ms-sde:next_action",
    );
    expect(dueSourceKey("opportunity_deadline", "ms-sde")).toBe(
      "opportunity:ms-sde:deadline",
    );
    expect(dueSourceKey("referral_follow_up", "referral-rahul")).toBe(
      "referral:referral-rahul:follow_up",
    );
    expect(dueSourceKey("task", "task-prep")).toBe("task:task-prep");

    for (const key of [
      dueSourceKey("contact_next_action", "rahul"),
      dueSourceKey("task", "task-prep"),
    ]) {
      expect(key).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it("keeps the same key when the due date moves", () => {
    const before = dueSourceKey("contact_next_action", "rahul");
    expect(reschedulePreservesKey(before, "2026-09-02", "2026-09-08")).toBe(
      before,
    );
    expect(parseDueSourceKey(before)).toEqual({
      kind: "contact_next_action",
      entityId: "rahul",
    });
    expect(parseDueSourceKey("not-a-key")).toBeNull();
    expect(parseDueSourceKey(dueSourceKey("opportunity_deadline", "ms-sde"))).toEqual({
      kind: "opportunity_deadline",
      entityId: "ms-sde",
    });
  });

  it("titles a derived due item from the next-action string or a stable default", () => {
    expect(derivedDueItemTitle("contact_next_action", " Ping Priya ")).toBe(
      "Ping Priya",
    );
    expect(derivedDueItemTitle("contact_next_action", "")).toBe("Follow up");
    expect(derivedDueItemTitle("referral_follow_up", null)).toBe(
      "Check referral",
    );
    expect(derivedDueItemTitle("opportunity_deadline", null)).toBe(
      "Application deadline",
    );
  });
});
