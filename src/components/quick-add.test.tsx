import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({
  usePathname: () => "/contacts",
  useRouter: () => router,
}));
vi.mock("next/dynamic", () => ({
  default: () =>
    function PaletteStub() {
      return null;
    },
}));

import { AppShell } from "./app-shell";
import {
  companyNameFromJobUrl,
  QuickAdd,
  type QuickAddReferenceData,
} from "./quick-add";

const data: QuickAddReferenceData = {
  companies: [{ id: "company-a", name: "Amazon" }],
  contacts: [{ id: "contact-a", name: "Priya Nair" }],
  opportunities: [
    { id: "opportunity-a", companyName: "Amazon", role: "SDE" },
  ],
  today: "2026-09-01",
};

describe("global quick add", () => {
  it("keeps Add visible in the desktop topbar and mobile navigation", () => {
    const html = renderToStaticMarkup(
      <AppShell quickAddData={data}><p>Workspace</p></AppShell>,
    );

    expect(html).toContain('class="btn quick-add-trigger"');
    expect(html).toContain('aria-label="Open command palette"');
    expect(html).toContain('class="palette-trigger"');
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(3);
    expect(html).toContain('class="mobile-link"');
    expect(html).toContain("Notifications, 0 unread");
  });

  it("shows the unread bell count in accent tabular numerals", () => {
    const html = renderToStaticMarkup(
      <AppShell quickAddData={data} unreadCount={2}>
        <p>Workspace</p>
      </AppShell>,
    );
    expect(html).toContain("Notifications, 2 unread");
    expect(html).toContain('class="tnum">2</span>');
  });

  it("lists all nine actions and explains the remaining disabled action", () => {
    const html = renderToStaticMarkup(
      <QuickAdd data={data} onClose={() => undefined} returnFocusTo={null} />,
    );

    for (const label of [
      "Add job",
      "Add company",
      "Add contact",
      "Log interaction",
      "Add application",
      "Add interview",
      "Add task",
      "Compose email",
      "Create reminder",
    ]) expect(html).toContain(label);
    expect(html).toContain("Connect Gmail in Settings to compose email.");
    expect(html.match(/disabled=""/g)).toHaveLength(1);
    expect(html).not.toContain("Available after interview tracking lands.");
  });

  it("renders the interview capture with a job, round type, and time", () => {
    const html = renderToStaticMarkup(
      <QuickAdd
        data={data}
        initialAction="interview"
        onClose={() => undefined}
        returnFocusTo={null}
      />,
    );

    expect(html).toContain("Amazon — SDE");
    expect(html).toContain("Round type");
    expect(html).toContain('name="kind"');
    expect(html).toContain('name="time"');
    expect(html).toContain("Interviewer");
    expect(html).not.toContain("Available after interview tracking lands.");
  });

  it("renders the four-field phone interaction capture and direct Save", () => {
    const html = renderToStaticMarkup(
      <QuickAdd
        data={data}
        initialAction="interaction"
        onClose={() => undefined}
        returnFocusTo={null}
      />,
    );

    expect(html).toContain("Priya Nair");
    expect(html).toContain("WhatsApp");
    expect(html).toContain(">Message<");
    expect(html).toContain(">Save interaction<");
    expect(html).not.toContain(">Direction<");
  });

  it("renders reminder as a task-shaped title and required due date", () => {
    const html = renderToStaticMarkup(
      <QuickAdd
        data={data}
        initialAction="reminder"
        onClose={() => undefined}
        returnFocusTo={null}
      />,
    );

    expect(html).toContain('name="title"');
    expect(html).toContain('name="dueOn"');
    expect(html).toContain('type="date"');
    expect(html).toContain("Create reminder");
    expect(html).not.toContain('name="workspaceId"');
  });

  it("lets Add contact type a company name instead of picking an id", () => {
    const html = renderToStaticMarkup(
      <QuickAdd
        data={data}
        initialAction="contact"
        onClose={() => undefined}
        returnFocusTo={null}
      />,
    );

    expect(html).toContain('name="companyName"');
    expect(html).not.toContain('name="companyId"');
  });

  it("derives a company label from a pasted job host without fetching", () => {
    expect(companyNameFromJobUrl("https://jobs.amazon.com/en/jobs/999")).toBe(
      "Amazon",
    );
    expect(companyNameFromJobUrl("https://careers.microsoft.com/job/1")).toBe(
      "Microsoft",
    );
    expect(companyNameFromJobUrl("not a URL")).toBe("");
  });

  it("keeps the Add targets at the kit minimum and phone capture compact", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const button = css.slice(css.indexOf(".btn {"), css.indexOf(".btn:hover"));
    const mobile = css.slice(css.indexOf("/* Quick-add mobile sheet */"));

    expect(button).toContain("min-height: var(--target-min)");
    expect(mobile).toContain(".quick-add-form--interaction .quick-add-fields");
    expect(mobile).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
  });
});
