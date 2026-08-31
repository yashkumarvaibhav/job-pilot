import { describe, expect, it } from "vitest";

import { productionDatabasePath } from "./paths";
import { resolveDatabasePath } from "./runtime";

describe("productionDatabasePath", () => {
  it("sits beneath the app root", () => {
    expect(productionDatabasePath("/srv/job-pilot/app")).toBe(
      "/srv/job-pilot/app/var/job-pilot.sqlite",
    );
  });
});

describe("resolveDatabasePath", () => {
  it("prefers an explicit DATABASE_PATH", () => {
    expect(resolveDatabasePath("/srv/data/app.sqlite")).toBe(
      "/srv/data/app.sqlite",
    );
  });

  it("resolves a relative override against the process root", () => {
    expect(resolveDatabasePath("./var/dev.sqlite")).toBe(
      `${process.cwd()}/var/dev.sqlite`,
    );
  });

  it("falls back to the production location", () => {
    for (const configured of [undefined, "", "   "]) {
      expect(resolveDatabasePath(configured)).toBe(productionDatabasePath());
    }
  });
});
