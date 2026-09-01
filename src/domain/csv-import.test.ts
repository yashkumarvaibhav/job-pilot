import { describe, expect, it } from "vitest";

import { CsvImportError, parseCsv } from "./csv-import";

describe("CSV parsing", () => {
  it("preserves quoted commas, escaped quotes, blank cells and physical row numbers", () => {
    expect(
      parseCsv(
        '\uFEFFName,Notes,Website\r\n"Acme, Inc.","Said ""hello""",https://acme.invalid.test\r\nBlank,,\r\n',
      ),
    ).toEqual({
      headers: ["Name", "Notes", "Website"],
      rows: [
        {
          line: 2,
          values: ["Acme, Inc.", 'Said "hello"', "https://acme.invalid.test"],
        },
        { line: 3, values: ["Blank", "", ""] },
      ],
    });
  });

  it("rejects an unclosed quoted field with its source line", () => {
    expect(() => parseCsv('Name,Notes\nAcme,"unfinished')).toThrowError(
      new CsvImportError("Unclosed quoted field on line 2."),
    );
  });

  it("rejects duplicate and blank headers before any row is planned", () => {
    expect(() => parseCsv("Name,Name\nA,B")).toThrowError(
      "CSV headers must be unique.",
    );
    expect(() => parseCsv("Name,\nA,B")).toThrowError(
      "CSV headers cannot be blank.",
    );
  });
});
