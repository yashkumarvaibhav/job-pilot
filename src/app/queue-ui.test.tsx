import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { QueueManager } from "@/components/queue-manager";

function view() {
  return (
    <QueueManager
      items={[
        {
          id: "queue-a",
          accountEmail: "sender@invalid.test",
          contactName: "Contact A",
          origin: "one_off",
          status: "awaiting_approval",
          subject: "Visible subject only",
          sendAt: "2026-09-04T03:30:00.000Z",
          sentAt: null,
          lastError: null,
        },
      ]}
      suppression={[
        {
          id: "suppression-a",
          email: "blocked@invalid.test",
          reason: "manual",
          at: "2026-09-03T10:00:00.000Z",
        },
      ]}
      timeZone="Asia/Kolkata"
      usage={[
        {
          id: "account-a",
          email: "sender@invalid.test",
          sentToday: 0,
          dailyLimit: 2,
        },
      ]}
    />
  );
}

describe("queue UI", () => {
  it("shows safe list facts, exact tabs and icon-plus-text states", () => {
    const html = renderToStaticMarkup(view());
    expect(html).toContain("0 / 2 sent today");
    expect(html).toContain("Awaiting approval");
    expect(html).toContain("Approved");
    expect(html).toContain("Held");
    expect(html).toContain("Sent");
    expect(html).toContain("Visible subject only");
    expect(html).toContain("blocked@invalid.test");
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("Complete private body");
    expect(html).not.toContain("token_blob");
  });

  it("loads complete content only from one selected detail endpoint", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/queue-manager.tsx"),
      "utf8",
    );
    expect(source).toContain("fetch(`/api/queue/${encodeURIComponent(id)}`)");
    expect(source).toContain("Complete body");
    expect(source).toContain("Approve and schedule");
    expect(source).toContain("I checked Gmail Sent and want to approve a new attempt.");
    expect(source).toContain("uncertainDeliveryAcknowledged");
    expect(source).not.toContain("Approve all");
  });

  it("uses tokens, an independently scrolling table and a mobile stack", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const queue = css.slice(
      css.indexOf("/* Send queue"),
      css.indexOf("/* Job Inbox"),
    );
    expect(queue).toContain("var(--raised)");
    expect(queue).toContain("var(--line)");
    expect(queue).toContain("overflow-x: auto");
    expect(queue).toContain("@media (max-width: 767px)");
    expect(queue).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
