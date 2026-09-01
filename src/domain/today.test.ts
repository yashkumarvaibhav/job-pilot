import { describe, expect, it } from "vitest";

import { dueSourceKey } from "./due-source";
import {
  TODAY_EMPTY,
  TODAY_PIPELINE_TILES,
  TODAY_STAT_TILES,
  isDueOnOrBefore,
  todayDisconnectedCopy,
  todayDoNowHeading,
  todayDoNowVerb,
  todayDoNowVerbForKey,
  todayOpportunityPipelineTile,
} from "./today";

describe("Today domain", () => {
  it("names the empty sentence and the count tiles", () => {
    expect(TODAY_EMPTY).toBe(
      "Nothing due today. Add a contact or a job to start the loop.",
    );
    expect(TODAY_STAT_TILES.map(({ label }) => label)).toEqual([
      "Follow-ups",
      "Need reply",
      "Deadlines",
      "Interviews today",
    ]);
    expect(TODAY_PIPELINE_TILES.map(({ label }) => label)).toEqual([
      "Saved",
      "Referral",
      "Applied",
      "OA",
      "Interview",
      "Offer",
    ]);
  });

  it("treats due work as a calendar comparison, not a tick", () => {
    expect(isDueOnOrBefore("2026-09-01", "2026-09-02")).toBe(true);
    expect(isDueOnOrBefore("2026-09-02", "2026-09-02")).toBe(true);
    expect(isDueOnOrBefore("2026-09-03", "2026-09-02")).toBe(false);
    expect(isDueOnOrBefore(null, "2026-09-02")).toBe(false);
  });

  it("maps Do Now verbs from the JP-0014 source key", () => {
    expect(todayDoNowVerb("contact_next_action")).toBe("Follow up");
    expect(todayDoNowVerb("opportunity_next_action")).toBe("Apply");
    expect(todayDoNowVerb("task")).toBe("Do");
    expect(
      todayDoNowVerbForKey(dueSourceKey("contact_next_action", "rahul")),
    ).toBe("Follow up");
    expect(
      todayDoNowHeading(
        dueSourceKey("contact_next_action", "rahul"),
        "Follow up",
        "Rahul Sharma",
      ),
    ).toBe("Follow up with Rahul Sharma");
  });

  it("rolls opportunity and application stages into the six pipeline tiles", () => {
    expect(todayOpportunityPipelineTile("saved", null)).toBe("saved");
    expect(todayOpportunityPipelineTile("ready_to_apply", null)).toBe(
      "saved",
    );
    expect(todayOpportunityPipelineTile("applied", "applied")).toBe(
      "applied",
    );
    expect(todayOpportunityPipelineTile("applied", "oa_received")).toBe("oa");
    expect(
      todayOpportunityPipelineTile("applied", "interview_scheduled"),
    ).toBe("interview");
    expect(todayOpportunityPipelineTile("applied", "offer")).toBe("offer");
    expect(todayOpportunityPipelineTile("applied", "rejected")).toBe(null);
    expect(todayOpportunityPipelineTile("position_closed", null)).toBe(null);
  });

  it("only banners when a Gmail row exists and is not connected", () => {
    expect(todayDisconnectedCopy(null)).toBeNull();
    expect(todayDisconnectedCopy("connected")).toBeNull();
    expect(todayDisconnectedCopy("disconnected")).toBe(
      "Gmail disconnected — sends will fail",
    );
  });
});
