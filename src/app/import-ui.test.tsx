import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ImportDisabledNotice,
  ImportWorkspace,
} from "@/components/import-workspace";

describe("import settings UI", () => {
  it("renders the complete staged import workflow with an initially gated apply", () => {
    const html = renderToStaticMarkup(<ImportWorkspace />);

    expect(html).toContain("Settings");
    expect(html).toContain("CSV import");
    expect(html).toContain("Choose CSV file");
    expect(html).toContain("Companies");
    expect(html).toContain("Map CSV columns");
    expect(html).toContain("Dry run");
    expect(html).toContain("Apply import");
    expect(html).toContain("disabled");
    expect(html).toContain("import-mapping-table");
  });

  it("renders a visible public-demo safety state without a file input", () => {
    const html = renderToStaticMarkup(<ImportDisabledNotice />);

    expect(html).toContain("Import is disabled in the public demo");
    expect(html).toContain("synthetic workspace");
    expect(html).not.toContain('type="file"');
  });
});
