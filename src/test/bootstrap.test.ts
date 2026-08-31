import packageMetadata from "../../package.json";
import { describe, expect, it } from "vitest";

describe("project bootstrap", () => {
  it("uses the product package name", () => {
    expect(packageMetadata.name).toBe("job-pilot");
  });
});
