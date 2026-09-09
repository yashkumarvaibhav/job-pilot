import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ContactPreviewDialog,
  type ContactPreviewData,
} from "./contact-preview";

const CONTACT: ContactPreviewData = {
  id: "rahul",
  companyId: "microsoft",
  companyName: "Microsoft",
  name: "Rahul Sharma",
  designation: "Software Engineer",
  relationship: "friend",
  source: "College network",
  location: "Bengaluru",
  notes: "Ask about platform roles.",
  preferredContactChannel: "linkedin",
  networkingStatus: "checking_for_openings",
  lastInteractionAt: null,
  nextAction: "Follow up",
  followUpOn: "2026-09-12",
  methods: [
    {
      id: "linkedin-rahul",
      kind: "linkedin",
      value: "https://www.linkedin.com/in/rahul",
      isPrimary: true,
      createdAt: "2026-09-09T00:00:00.000Z",
    },
  ],
  createdAt: "2026-09-09T00:00:00.000Z",
};

describe("contact preview", () => {
  it("renders a labelled modal with explicit close and new-tab actions", () => {
    const html = renderToStaticMarkup(
      <ContactPreviewDialog
        contactId="rahul"
        contactName="Rahul Sharma"
        onClose={() => undefined}
        opener={null}
        state={{ kind: "ready", contact: CONTACT }}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="contact-preview-title"');
    expect(html).toContain('aria-label="Close contact preview"');
    expect(html).toContain('href="/contacts/rahul"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Open contact in new tab");
    expect(html).toContain("Rahul Sharma");
    expect(html).toContain("Microsoft");
    expect(html).toContain("Checking for Openings");
    expect(html).toContain("Open LinkedIn profile");
    expect(html).toContain('href="https://www.linkedin.com/in/rahul"');
  });

  it("keeps loading, failure and missing-contact results inside the dialog", () => {
    const loading = renderToStaticMarkup(
      <ContactPreviewDialog
        contactId="rahul"
        contactName="Rahul Sharma"
        onClose={() => undefined}
        opener={null}
        state={{ kind: "loading" }}
      />,
    );
    const failed = renderToStaticMarkup(
      <ContactPreviewDialog
        contactId="rahul"
        contactName="Rahul Sharma"
        onClose={() => undefined}
        opener={null}
        state={{ kind: "error", missing: false }}
      />,
    );
    const missing = renderToStaticMarkup(
      <ContactPreviewDialog
        contactId="rahul"
        contactName="Rahul Sharma"
        onClose={() => undefined}
        opener={null}
        state={{ kind: "error", missing: true }}
      />,
    );

    expect(loading).toContain("Loading contact preview");
    expect(failed).toContain("Could not load this contact");
    expect(failed).toContain("Retry");
    expect(missing).toContain("Contact not found");
  });

  it("uses brand tokens, internal overflow and narrow-screen sizing", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const start = css.indexOf("/* Contact preview dialog");
    const styles = css.slice(start, css.indexOf("/* Gmail composer", start));

    expect(start).toBeGreaterThan(-1);
    expect(styles).toContain("background: var(--raised)");
    expect(styles).toContain("border: 1px solid var(--line)");
    expect(styles).toContain("box-shadow: var(--shadow-lg)");
    expect(styles).toContain("overflow-y: auto");
    expect(styles).toContain("min-height: var(--target-min)");
    expect(styles).toContain("@media (max-width: 767px)");
    expect(/#[0-9a-fA-F]{3,8}/.test(styles)).toBe(false);
  });
});
