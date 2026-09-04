import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/sequences",
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { SEQUENCE_ENROLLMENT_COPY, SEQUENCE_STOP_REASON_COPY } from "@/domain/sequence";
import { SequenceEnrollForm } from "@/components/sequence-enroll-form";
import { SequenceManager } from "@/components/sequence-manager";
import { SettingsNav } from "@/components/settings-nav";
import { DueItemCollection } from "@/components/due-list";
import SequencesError from "./(app)/settings/sequences/error";
import SequencesLoading from "./(app)/settings/sequences/loading";

describe("sequence UI", () => {
  it("renders the editor, enrollment copy and stop reasons", () => {
    const html = renderToStaticMarkup(
      <SequenceManager
        sequences={[
          {
            id: "seq-cold",
            name: "Cold email",
            enrollmentCount: 0,
            steps: [
              { offsetDays: 0, templateId: "template-tiny" },
              { offsetDays: 4, templateId: "template-tiny" },
            ],
          },
        ]}
        templates={[{ id: "template-tiny", title: "Tiny follow-up" }]}
      />,
    );
    expect(html).toContain("Cold email");
    expect(html).toContain("Day 0 template");
    expect(html).toContain("Day 4 template");
    expect(html).toContain("Each due email requires your approval.");
    expect(html).toContain("Save sequence");
    expect(html).not.toContain("Send anyway");
  });

  it("shows stop on an active enrollment and lists cancel reasons", () => {
    const html = renderToStaticMarkup(
      <SequenceEnrollForm
        accounts={[
          { id: "account-default", email: "default@invalid.test", isDefault: true },
          { id: "account-a", email: "sender@invalid.test" },
        ]}
        defaultContactId="contact-priya"
        enrollments={[
          {
            id: "enroll-a",
            sequenceName: "Cold email",
            status: "active",
            cancelReason: null,
            nextAt: "2026-09-04T10:00:00.000Z",
          },
        ]}
        sequences={[{ id: "seq-cold", name: "Cold email" }]}
      />,
    );
    expect(html).toContain(SEQUENCE_ENROLLMENT_COPY);
    expect(html).toContain("default@invalid.test — default");
    expect(html).toContain("sender@invalid.test");
    expect(html).toContain("Stop");
    expect(html).toContain("Enroll");
    for (const reason of SEQUENCE_STOP_REASON_COPY) {
      expect(html).toContain(reason);
    }
  });

  it("adds Sequences to settings navigation as the active page", () => {
    const html = renderToStaticMarkup(<SettingsNav />);
    expect(html).toContain('href="/settings/sequences"');
    expect(html).toContain('aria-current="page"');
  });

  it("links Today sequence rows to Queue review instead of Create task", () => {
    const html = renderToStaticMarkup(
      <DueItemCollection
        asOfOn="2026-09-04"
        rows={[
          {
            sourceKey: "enrollment:enroll-a:step:step-0",
            origin: "derived",
            title: "Review follow-up email",
            dueOn: "2026-09-04",
            entityType: "contact",
            entityId: "contact-priya",
            entityLabel: "Priya Shah",
            taskId: null,
            derivedFromKey: null,
            priority: null,
            status: null,
          },
        ]}
      />,
    );
    expect(html).toContain("Review follow-up with Priya Shah");
    expect(html).toContain("/settings/queue?review=");
    expect(html).toContain(">Review<");
    expect(html).not.toContain("Create task");
  });

  it("designs loading and error states and uses tokens only", () => {
    expect(renderToStaticMarkup(<SequencesLoading />)).toContain("Loading sequences");
    expect(
      renderToStaticMarkup(<SequencesError reset={() => undefined} />),
    ).toContain("Could not load sequences");
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const styles = css.slice(css.indexOf("/* Owner-written template library"));
    expect(styles).toContain(".sequence-manager");
    expect(styles).toContain("var(--raised)");
    expect(styles).toContain("var(--line)");
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(styles.slice(0, styles.indexOf("@media"))).not.toContain("box-shadow");
  });
});
