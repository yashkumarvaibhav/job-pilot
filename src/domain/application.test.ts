import { describe, expect, it } from "vitest";

import {
  APPLICATION_STAGES,
  applicationResultLabel,
  rolledUpPipelineStage,
} from "./application";

describe("application domain", () => {
  it("ships the section 38 post-apply stages in published order", () => {
    expect(APPLICATION_STAGES.map(({ label }) => label)).toEqual([
      "Applied",
      "Application Confirmed",
      "Under Review",
      "OA Received",
      "OA Completed",
      "Interview Scheduled",
      "Interview Round 1",
      "Interview Round 2",
      "Hiring Manager",
      "HR",
      "Offer",
      "Rejected",
      "Withdrawn",
      "Ghosted",
    ]);
  });

  it("does not treat Not Applied as an application stage", () => {
    expect(APPLICATION_STAGES.map(({ label }) => label)).not.toContain(
      "Not Applied",
    );
  });

  it("prefers application.stage for the rolled-up chip", () => {
    expect(rolledUpPipelineStage("ready_to_apply", "under_review")).toEqual({
      value: "under_review",
      label: "Under Review",
      source: "application",
    });
    expect(rolledUpPipelineStage("applied", "applied")).toEqual({
      value: "applied",
      label: "Applied",
      source: "application",
    });
    expect(rolledUpPipelineStage("interested", null)).toEqual({
      value: "interested",
      label: "Interested",
      source: "opportunity",
    });
  });

  it("reports a result only for terminal application stages", () => {
    expect(applicationResultLabel("under_review")).toBe("—");
    expect(applicationResultLabel("offer")).toBe("Offer");
    expect(applicationResultLabel("rejected")).toBe("Rejected");
  });
});
