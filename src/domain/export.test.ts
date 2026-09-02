import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv-import";
import {
  ExportInputError,
  exportFilename,
  omitExportSecrets,
  parseExportQuery,
  serializeCsv,
} from "./export";

describe("export query", () => {
  it("accepts JSON of everything and each CSV table", () => {
    expect(parseExportQuery(new URLSearchParams("format=json&set=all"))).toEqual({
      format: "json",
      set: "all",
    });
    expect(
      parseExportQuery(new URLSearchParams("format=csv&set=contacts")),
    ).toEqual({ format: "csv", set: "contacts" });
    expect(parseExportQuery(new URLSearchParams("format=csv&set=jobs"))).toEqual({
      format: "csv",
      set: "jobs",
    });
    expect(
      parseExportQuery(new URLSearchParams("format=csv&set=applications")),
    ).toEqual({ format: "csv", set: "applications" });
    expect(
      parseExportQuery(new URLSearchParams("format=csv&set=activity")),
    ).toEqual({ format: "csv", set: "activity" });
  });

  it("refuses CSV of everything and unknown values", () => {
    expect(() =>
      parseExportQuery(new URLSearchParams("format=csv&set=all")),
    ).toThrow(ExportInputError);
    expect(() =>
      parseExportQuery(new URLSearchParams("format=xml&set=all")),
    ).toThrow(/JSON or CSV/);
    expect(() =>
      parseExportQuery(new URLSearchParams("format=json&set=sessions")),
    ).toThrow(/all, jobs, contacts, applications, or activity/);
  });
});

describe("CSV serialisation", () => {
  it("writes a header row that a spreadsheet can reopen, including quoted commas", () => {
    const csv = serializeCsv(
      ["Name", "Email", "Notes"],
      [
        ["Rahul Sharma", "rahul@invalid.test", 'Said "hello", then left'],
        ["Ada", null, undefined],
      ],
    );

    expect(csv.startsWith("\uFEFF")).toBe(true);
    const parsed = parseCsv(csv);
    expect(parsed.headers).toEqual(["Name", "Email", "Notes"]);
    expect(parsed.rows[0]?.values).toEqual([
      "Rahul Sharma",
      "rahul@invalid.test",
      'Said "hello", then left',
    ]);
    expect(parsed.rows[1]?.values).toEqual(["Ada", "", ""]);
  });
});

describe("export secrets", () => {
  it("keeps a contact email and drops password hashes, tokens, sessions and workspace ids", () => {
    const cleaned = omitExportSecrets({
      name: "Rahul Sharma",
      email: "rahul@invalid.test",
      workspaceId: "workspace-a",
      passwordHash: "synthetic-password-hash-a",
      APP_PASSWORD: "never-export-this",
      nested: {
        tokenDigest: "abc",
        refreshToken: "xyz",
        note: "ok",
      },
      createdAt: new Date("2026-09-02T10:00:00.000Z"),
    });

    expect(cleaned).toEqual({
      name: "Rahul Sharma",
      email: "rahul@invalid.test",
      nested: { note: "ok" },
      createdAt: "2026-09-02T10:00:00.000Z",
    });

    const json = JSON.stringify(cleaned);
    expect(json).toContain("rahul@invalid.test");
    expect(json).not.toMatch(/password/i);
    expect(json).not.toContain("APP_PASSWORD");
    expect(json).not.toContain("workspace-a");
    expect(json).not.toContain("token");
  });

  it("names download files from the format and set", () => {
    expect(exportFilename("json", "all")).toBe("job-pilot.json");
    expect(exportFilename("csv", "contacts")).toBe("job-pilot-contacts.csv");
  });
});
