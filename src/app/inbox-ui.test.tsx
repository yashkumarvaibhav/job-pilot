import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { InboxWorkspace } from "@/components/inbox-workspace";

describe("Job Inbox UI", () => {
  it("renders the multi-account mailbox, matching and manual controls", () => {
    const html = renderToStaticMarkup(
      <InboxWorkspace
        accounts={[
          {
            id: "account-a",
            email: "one@invalid.test",
            status: "connected",
            lastSyncAt: "2026-09-03T16:00:00.000Z",
            sequenceSafeAt: "2026-09-03T15:00:00.000Z",
            lastSyncError: null,
          },
          {
            id: "account-b",
            email: "two@invalid.test",
            status: "disconnected",
            lastSyncAt: null,
            sequenceSafeAt: null,
            lastSyncError: "Authorization expired.",
          },
        ]}
        contacts={[{ id: "rahul", name: "Rahul", companyName: "Microsoft" }]}
        gmailConfigured
        threads={[
          {
            id: "thread-a",
            accountId: "account-a",
            accountEmail: "one@invalid.test",
            accountStatus: "connected",
            counterpartEmail: "rahul@example.com",
            subject: "Re: Referral request",
            contactId: null,
            linkedLabel: "Unmatched",
            matchStatus: "suggested",
            matchReason: "Company domain only",
            suggestedContacts: [{ id: "rahul", name: "Rahul" }],
            lastMessageAt: "2026-09-03T16:00:00.000Z",
            messages: [
              {
                id: "message-a",
                direction: "inbound",
                fromEmail: "rahul@example.com",
                to: ["one@invalid.test"],
                subject: "Re: Referral request",
                body: "Happy to help.",
                sentAt: "2026-09-03T16:00:00.000Z",
                classification: null,
              },
            ],
          },
        ]}
      />,
    );

    expect(html).toContain("Job Inbox");
    expect(html).toContain("All accounts");
    expect(html).toContain("Import Gmail thread");
    expect(html).toContain("one@invalid.test");
    expect(html).toContain("two@invalid.test is disconnected");
    expect(html).toContain("Sequence safety is still reconciling");
    expect(html).toContain("Suggested match");
    expect(html).toContain("Confirm Rahul");
    expect(html).toContain("Relink to contact");
    expect(html).toContain("Classify reply");
    for (const label of [
      "Referral promised",
      "Referral submitted",
      "Declined",
      "Need to respond",
      "No opening",
      "Follow up later",
      "Not relevant",
    ]) {
      expect(html).toContain(label);
    }
  });

  it("declares token-only split-pane and narrow single-column behavior", () => {
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const inbox = css.slice(css.indexOf("/* Job Inbox"), css.indexOf(".detail-header__actions"));
    expect(inbox).toContain("grid-template-columns: minmax(17rem, 21rem) minmax(0, 1fr)");
    expect(inbox).toContain("@media (max-width: 767px)");
    expect(inbox).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(inbox).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
