import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DuplicateWarning } from "@/components/duplicate-warning";
import { DUPLICATE_JOB_WARNING } from "@/domain/duplicate";

describe("duplicate warning", () => {
  it("pairs a warning chip with the published sentence, the original, and Create anyway", () => {
    const html = renderToStaticMarkup(
      <DuplicateWarning
        conflict={{
          error: DUPLICATE_JOB_WARNING,
          candidates: [
            {
              id: "ms-sde",
              entityType: "opportunity",
              label: "Microsoft · SDE",
              href: "/opportunities/ms-sde",
              signals: ["same_company_job_id"],
            },
          ],
        }}
        onCreateAnyway={() => undefined}
      />,
    );

    expect(html).toContain("Possible duplicate");
    expect(html).toContain('data-status="degraded"');
    expect(html).toContain("This job may already be tracked.");
    expect(html).toContain("Microsoft · SDE");
    expect(html).toContain("/opportunities/ms-sde");
    expect(html).toContain("same company and job ID");
    expect(html).toContain("Create anyway");
    expect(html).toContain("aria-hidden=\"true\"");
  });
});
