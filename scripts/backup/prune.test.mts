import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { planRetention, pruneBackups } from "./prune.mjs";

const scratchRoots: string[] = [];

afterEach(() => {
  for (const root of scratchRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function scratchApp() {
  const root = mkdtempSync(join(tmpdir(), "job-pilot-prune-"));
  scratchRoots.push(root);
  const backupsRoot = join(root, "var", "backups");
  mkdirSync(backupsRoot, { recursive: true });
  return { root, backupsRoot };
}

/** One generation per day, newest last. */
function dailyNames(count: number, start = Date.parse("2026-01-01T02:00:00.000Z")) {
  return Array.from({ length: count }, (_unused, index) => {
    const at = new Date(start + index * 86_400_000);
    return at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  });
}

function makeGeneration(backupsRoot: string, name: string, bytes = 16) {
  mkdirSync(join(backupsRoot, name), { recursive: true });
  writeFileSync(join(backupsRoot, name, "job-pilot.sqlite"), "x".repeat(bytes));
}

describe("planRetention", () => {
  it("keeps the newest 14 generations", () => {
    const names = dailyNames(30);

    const plan = planRetention(names);

    expect(plan.keep).toContain(names.at(-1));
    expect(plan.keep.slice(-14)).toEqual(names.slice(-14));
    expect(plan.remove).not.toContain(names.at(-1));
  });

  it("keeps the last generation of each month and caps the monthlies at 12", () => {
    // Two years of daily backups: 730 generations, 24 distinct months.
    const names = dailyNames(730);

    const plan = planRetention(names);

    expect(plan.keep.length).toBeLessThanOrEqual(14 + 12);
    const months = new Set(plan.keep.map((name) => name.slice(0, 6)));
    expect(months.size).toBeLessThanOrEqual(13); // 12 monthlies + the current month
    // Inside the monthly window, the month's newest generation is the survivor.
    const june = names.filter((name) => name.startsWith("202706"));
    expect(plan.keep).toContain(june.at(-1));
    expect(plan.keep).not.toContain(june[0]);
    // Outside it, the whole month goes.
    expect(plan.keep.filter((name) => name.startsWith("202608"))).toEqual([]);
    // Nothing from before the retention horizon survives.
    expect(plan.keep).not.toContain(names[0]);
  });

  it("never leaves more than 14 dailies plus 12 monthlies", () => {
    for (const count of [1, 13, 14, 15, 40, 400, 1000]) {
      expect(planRetention(dailyNames(count)).keep.length).toBeLessThanOrEqual(26);
    }
  });

  it("keeps everything while there is little to keep", () => {
    const names = dailyNames(9);
    expect(planRetention(names).remove).toEqual([]);
  });

  it("separates same-second generations and leaves foreign directories alone", () => {
    const plan = planRetention([
      "20260831T214507Z",
      "20260831T214507Z-1",
      "notes",
      "20260831T2145Z",
    ]);

    expect(plan.keep).toEqual(["20260831T214507Z", "20260831T214507Z-1"]);
    expect(plan.unknown).toEqual(["20260831T2145Z", "notes"]);
    expect(plan.remove).toEqual([]);
  });
});

describe("pruneBackups", () => {
  it("removes expired generations from disk and reports what it kept", () => {
    const app = scratchApp();
    const names = dailyNames(40);
    for (const name of names) {
      makeGeneration(app.backupsRoot, name);
    }

    const result = pruneBackups({ appRoot: app.root });

    expect(result.removed.length).toBe(40 - result.kept.length);
    expect(readdirSync(app.backupsRoot).sort()).toEqual(result.kept);
    expect(result.overBudget).toBe(false);
  });

  it("prunes first and only then complains about the budget", () => {
    const app = scratchApp();
    const names = dailyNames(20);
    for (const name of names) {
      makeGeneration(app.backupsRoot, name, 1024);
    }

    // A budget nothing can satisfy: the expired generations must still go, or
    // the operator has no way to recover the space.
    const result = pruneBackups({ appRoot: app.root, budgetMb: 0 });

    expect(result.overBudget).toBe(true);
    expect(result.removed.length).toBeGreaterThan(0);
    expect(readdirSync(app.backupsRoot).length).toBe(result.kept.length);
    expect(result.bytes).toBe(result.kept.length * 1024);
  });

  it("reads the budget from the environment and rejects a nonsense value", () => {
    const app = scratchApp();
    makeGeneration(app.backupsRoot, dailyNames(1)[0], 2 * 1024 * 1024);

    expect(
      pruneBackups({ appRoot: app.root, env: { BACKUP_BUDGET_MB: "1" } }).overBudget,
    ).toBe(true);
    expect(
      pruneBackups({ appRoot: app.root, env: { BACKUP_BUDGET_MB: "8" } }).overBudget,
    ).toBe(false);
    expect(() =>
      pruneBackups({ appRoot: app.root, env: { BACKUP_BUDGET_MB: "plenty" } }),
    ).toThrowError(/must be a non-negative number/);
  });

  it("is a no-op when nothing has ever been backed up", () => {
    const app = scratchApp();
    rmSync(app.backupsRoot, { recursive: true });

    expect(pruneBackups({ appRoot: app.root })).toEqual({
      kept: [],
      removed: [],
      unknown: [],
      bytes: 0,
      budgetMb: 2048,
      overBudget: false,
    });
  });
});
