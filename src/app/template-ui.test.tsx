import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/templates",
}));

import { SettingsNav } from "@/components/settings-nav";
import { TemplateManager } from "@/components/template-manager";

describe("template library UI", () => {
  it("renders owner-written fields, variables, account choice, and attachment choice", () => {
    const html = renderToStaticMarkup(
      <TemplateManager
        accounts={[{ id: "account-a", email: "sender@invalid.test" }]}
        documents={[{ id: "resume-v4", displayName: "General SWE v4" }]}
        templates={[
          {
            id: "employee-referral",
            title: "Employee referral request",
            subject: "",
            body: "Write this template in your own words.",
            variablesJson: [],
            defaultEmailAccountId: null,
            defaultDocumentVersionId: null,
            defaultFollowUpDays: null,
            tagsJson: [],
          },
        ]}
      />,
    );

    expect(html).toContain("Employee referral request");
    expect(html).toContain("Write this template in your own words.");
    expect(html).toContain("Job Pilot substitutes literal variables");
    expect(html).toContain("{{first_name}}");
    expect(html).toContain("{{resume_name}}");
    expect(html).toContain("sender@invalid.test");
    expect(html).toContain("General SWE v4");
    expect(html).toContain("Save template");
    expect(html).toContain("Preview in composer");
  });

  it("adds Templates to settings navigation as the active page", () => {
    const html = renderToStaticMarkup(<SettingsNav />);
    expect(html).toContain('href="/settings/templates"');
    expect(html).toContain('aria-current="page"');
  });

  it("uses token-only two-column layout and stacks at 390px", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const styles = css.slice(css.indexOf("/* Owner-written template library"));
    expect(styles).toContain("var(--raised)");
    expect(styles).toContain("var(--line)");
    expect(styles).toContain("@media (max-width: 767px)");
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
