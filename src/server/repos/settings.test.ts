import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import { listActivity } from "./activity";
import { createContact } from "./contacts";
import {
  SettingsInputError,
  readWorkspaceSettings,
  updateWorkspaceSettings,
} from "./settings";
import { getTodaySnapshot } from "./today";
import { DEFAULT_SCORING_WEIGHTS } from "../../domain/scoring";

describe("settings repository", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.dispose();
    }
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    return fixture;
  }

  it("reads the row the account foundation created", () => {
    const fixture = newFixture();

    expect(readWorkspaceSettings(fixture.client.db, fixture.tenantA)).toEqual({
      displayName: "Tenant A",
      university: null,
      timezone: "Asia/Kolkata",
      quietStart: null,
      quietEnd: null,
      digestHour: null,
      digestEmailEnabled: false,
      digestAccountId: null,
      digestAccountEmail: null,
      scoringWeights: DEFAULT_SCORING_WEIGHTS,
      mutedNotificationKinds: [],
    });
  });

  it("persists scoring weights only in the current workspace", () => {
    const fixture = newFixture();

    const saved = updateWorkspaceSettings(fixture.client.db, fixture.tenantA, {
      displayName: "Tenant A",
      scoringWeights: { targetCompany: 0, newGradRole: 8 },
    });

    expect(saved.scoringWeights).toEqual({
      ...DEFAULT_SCORING_WEIGHTS,
      targetCompany: 0,
      newGradRole: 8,
    });
    expect(
      readWorkspaceSettings(fixture.client.db, fixture.tenantB).scoringWeights,
    ).toEqual(DEFAULT_SCORING_WEIGHTS);
    expect(() =>
      updateWorkspaceSettings(fixture.client.db, fixture.tenantA, {
        displayName: "Tenant A",
        scoringWeights: { targetCompany: 1.5 },
      }),
    ).toThrow(SettingsInputError);
    expect(() =>
      updateWorkspaceSettings(fixture.client.db, fixture.tenantA, {
        displayName: "Tenant A",
        scoringWeights: { hiddenTerm: 100 } as never,
      }),
    ).toThrow(SettingsInputError);
  });

  it("persists profile fields and quiet hours in workspace local time", () => {
    const fixture = newFixture();

    const saved = updateWorkspaceSettings(fixture.client.db, fixture.tenantA, {
      displayName: "  Yash Kumar Vaibhav  ",
      university: " IIIT Delhi ",
      timezone: "Asia/Kolkata",
      quietStart: "23:30",
      quietEnd: "08:00",
      now: new Date("2026-09-02T04:00:00.000Z"),
    });

    expect(saved.displayName).toBe("Yash Kumar Vaibhav");
    expect(saved.university).toBe("IIIT Delhi");
    expect(saved.quietStart).toBe(1410);
    expect(saved.quietEnd).toBe(480);
    expect(readWorkspaceSettings(fixture.client.db, fixture.tenantA)).toEqual(
      saved,
    );

    const cleared = updateWorkspaceSettings(fixture.client.db, fixture.tenantA, {
      displayName: "Yash Kumar Vaibhav",
      university: "",
      timezone: "Asia/Kolkata",
      quietStart: "",
      quietEnd: "",
    });
    expect(cleared.university).toBeNull();
    expect(cleared.quietStart).toBeNull();
    expect(cleared.quietEnd).toBeNull();
  });

  it("rejects an unusable timezone, a half-set window and an empty display name", () => {
    const fixture = newFixture();

    expect(() =>
      updateWorkspaceSettings(fixture.client.db, fixture.tenantA, {
        displayName: "Tenant A",
        timezone: "Mars/Olympus_Mons",
      }),
    ).toThrow(SettingsInputError);
    expect(() =>
      updateWorkspaceSettings(fixture.client.db, fixture.tenantA, {
        displayName: "Tenant A",
        timezone: "Asia/Kolkata",
        quietStart: "23:30",
        quietEnd: "",
      }),
    ).toThrow(SettingsInputError);
    expect(() =>
      updateWorkspaceSettings(fixture.client.db, fixture.tenantA, {
        displayName: "   ",
        timezone: "Asia/Kolkata",
      }),
    ).toThrow(SettingsInputError);

    // Nothing partial was written.
    expect(readWorkspaceSettings(fixture.client.db, fixture.tenantA).timezone).toBe(
      "Asia/Kolkata",
    );
  });

  it("records a timezone change in activity only when the zone actually moves", () => {
    const fixture = newFixture();

    updateWorkspaceSettings(fixture.client.db, fixture.tenantA, {
      displayName: "Tenant A",
      timezone: "Asia/Kolkata",
      now: new Date("2026-09-02T04:00:00.000Z"),
    });
    expect(
      listActivity(fixture.client.db, fixture.tenantA, { timeZone: "UTC" }).filter(
        (row) => row.kind === "SETTINGS_TIMEZONE_CHANGED",
      ),
    ).toHaveLength(0);

    updateWorkspaceSettings(fixture.client.db, fixture.tenantA, {
      displayName: "Tenant A",
      timezone: "America/New_York",
      now: new Date("2026-09-02T05:00:00.000Z"),
    });
    const changes = listActivity(fixture.client.db, fixture.tenantA, {
      timeZone: "UTC",
    }).filter((row) => row.kind === "SETTINGS_TIMEZONE_CHANGED");
    expect(changes).toHaveLength(1);
    expect(changes[0].payload).toEqual({
      from: "Asia/Kolkata",
      to: "America/New_York",
    });
  });

  it("keeps one workspace's profile, zone and Today date away from another", () => {
    const fixture = newFixture();
    const now = new Date("2026-09-02T18:45:00.000Z");

    // Kolkata is already on the 3rd at this instant; New York is still on the 2nd.
    createContact(fixture.client.db, fixture.tenantA, {
      id: "contact-a",
      name: "Priya Nair",
      followUpOn: "2026-09-03",
    });
    createContact(fixture.client.db, fixture.tenantB, {
      id: "contact-b",
      name: "Other Person",
      followUpOn: "2026-09-03",
    });

    updateWorkspaceSettings(fixture.client.db, fixture.tenantA, {
      displayName: "Workspace A owner",
      university: "IIIT Delhi",
      timezone: "Asia/Kolkata",
      quietStart: "23:30",
      quietEnd: "08:00",
      now,
    });

    const b = readWorkspaceSettings(fixture.client.db, fixture.tenantB);
    expect(b.displayName).toBe("Tenant B");
    expect(b.university).toBeNull();
    expect(b.timezone).toBe("America/New_York");
    expect(b.quietStart).toBeNull();
    expect(b.quietEnd).toBeNull();

    const todayA = getTodaySnapshot(fixture.client.db, fixture.tenantA, { now });
    const todayB = getTodaySnapshot(fixture.client.db, fixture.tenantB, { now });
    expect(todayA.asOfOn).toBe("2026-09-03");
    expect(todayB.asOfOn).toBe("2026-09-02");
    expect(todayA.stats.followUps).toBe(1);
    expect(todayB.stats.followUps).toBe(0);

    // Workspace A's write left no activity row in workspace B.
    expect(
      listActivity(fixture.client.db, fixture.tenantB, { timeZone: "UTC" }).filter(
        (row) => row.kind === "SETTINGS_TIMEZONE_CHANGED",
      ),
    ).toHaveLength(0);
  });

  it("never writes through a browser-supplied workspace id", () => {
    const fixture = newFixture();

    expect(() =>
      updateWorkspaceSettings(fixture.client.db, fixture.tenantA, {
        displayName: "Impostor",
        timezone: "America/New_York",
        workspaceId: fixture.tenantB.workspaceId,
      } as never),
    ).toThrow(SettingsInputError);

    expect(readWorkspaceSettings(fixture.client.db, fixture.tenantB)).toMatchObject(
      { displayName: "Tenant B", timezone: "America/New_York" },
    );
  });

  it("changing the zone does not move a stored UTC instant", () => {
    const fixture = newFixture();
    const createdAt = new Date("2026-09-02T18:45:00.000Z");

    createContact(fixture.client.db, fixture.tenantA, {
      id: "contact-instant",
      name: "Priya Nair",
      now: createdAt,
    });
    const before = fixture.client.sqlite
      .prepare("select created_at from contact where id = ?")
      .get("contact-instant") as { created_at: number | string };

    updateWorkspaceSettings(fixture.client.db, fixture.tenantA, {
      displayName: "Tenant A",
      timezone: "America/New_York",
      now: createdAt,
    });

    const after = fixture.client.sqlite
      .prepare("select created_at from contact where id = ?")
      .get("contact-instant") as { created_at: number | string };
    expect(after.created_at).toEqual(before.created_at);
  });
});
