import { describe, expect, it } from "vitest";

import {
  CONTACT_RELATIONSHIPS,
  DO_NOT_CONTACT,
  NETWORKING_STATUSES,
  NetworkingStatusTransitionError,
  transitionNetworkingStatus,
} from "./contact";

describe("contact domain", () => {
  it("ships every relationship from section 4 in its published order", () => {
    expect(CONTACT_RELATIONSHIPS.map(({ label }) => label)).toEqual([
      "Friend",
      "College friend",
      "Alumni",
      "Employee",
      "Recruiter",
      "Hiring Manager",
      "Former employee",
      "Mutual connection",
      "Community contact",
      "Unknown / cold contact",
      "Other",
    ]);
  });

  it("ships every networking status from section 6 in its published order", () => {
    expect(NETWORKING_STATUSES.map(({ label }) => label)).toEqual([
      "Not Contacted",
      "Ready to Contact",
      "Contacted",
      "Waiting for Reply",
      "Checking for Openings",
      "Follow Up Later",
      "Opening Found",
      "Referral Discussion",
      "Referral Promised",
      "No Openings Currently",
      "Keep in Touch",
      "Do Not Contact",
      "Inactive",
    ]);
  });

  it("allows every transition unless the current status is Do Not Contact", () => {
    for (const current of NETWORKING_STATUSES) {
      for (const next of NETWORKING_STATUSES) {
        if (current.value === DO_NOT_CONTACT && next.value !== DO_NOT_CONTACT) {
          expect(() => transitionNetworkingStatus(current.value, next.value)).toThrow(
            NetworkingStatusTransitionError,
          );
        } else {
          expect(transitionNetworkingStatus(current.value, next.value)).toBe(
            next.value,
          );
        }
      }
    }
  });

  it("leaves Do Not Contact only through an explicit override", () => {
    expect(
      transitionNetworkingStatus(DO_NOT_CONTACT, "keep_in_touch", {
        overrideDoNotContact: true,
      }),
    ).toBe("keep_in_touch");
  });
});
