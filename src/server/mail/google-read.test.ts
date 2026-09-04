import { describe, expect, it, vi } from "vitest";

import { GmailHistoryGapError } from "./inbox-sync";
import { GoogleGmailReadError, GoogleGmailReadPort } from "./google-read";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

describe("Google Gmail readonly adapter", () => {
  it("reads profile, history and bounded thread search with a deadline", async () => {
    const requests: URL[] = [];
    const signals: (AbortSignal | null | undefined)[] = [];
    let tokenRequests = 0;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input.toString());
      signals.push(init?.signal);
      if (url.hostname === "oauth2.googleapis.com") {
        tokenRequests += 1;
        return json({ access_token: "access", expires_in: 3600 });
      }
      requests.push(url);
      if (url.pathname.endsWith("/profile")) return json({ historyId: "99" });
      if (url.pathname.endsWith("/history")) {
        return json({
          historyId: "101",
          nextPageToken: "page-2",
          history: [
            { messagesAdded: [{ message: { id: "m-1", threadId: "t-1" } }] },
            { messagesAdded: [{ message: { id: "m-2", threadId: "t-1" } }] },
            { messagesAdded: [{ message: { id: "m-3", threadId: "t-2" } }] },
          ],
        });
      }
      return json({ threads: [{ id: "t-3" }, { id: "t-4" }] });
    });
    const reader = new GoogleGmailReadPort(
      { clientId: "client", clientSecret: "secret" },
      { fetcher },
    );

    await expect(
      reader.getProfileHistoryId({ refreshToken: "refresh" }),
    ).resolves.toBe("99");
    await expect(
      reader.listHistory({
        refreshToken: "refresh",
        startHistoryId: "88",
        pageToken: "page-1",
      }),
    ).resolves.toEqual({
      historyId: "101",
      threadIds: ["t-1", "t-2"],
      nextPageToken: "page-2",
    });
    await expect(
      reader.listThreads({
        refreshToken: "refresh",
        query: "from:jobs@example.com",
        maxResults: 50,
        pageToken: null,
      }),
    ).resolves.toEqual({ threadIds: ["t-3", "t-4"], nextPageToken: null });

    expect(requests[1].searchParams.get("startHistoryId")).toBe("88");
    expect(requests[1].searchParams.get("pageToken")).toBe("page-1");
    expect(requests[2].searchParams.get("q")).toBe("from:jobs@example.com");
    expect(requests[2].searchParams.get("maxResults")).toBe("50");
    expect(tokenRequests).toBe(1);
    expect(signals).toHaveLength(4);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  });

  it("reuses a token until its safe expiry margin, then refreshes it", async () => {
    let now = new Date("2026-09-04T10:00:00.000Z");
    let tokenRequests = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString());
      if (url.hostname === "oauth2.googleapis.com") {
        tokenRequests += 1;
        return json({ access_token: `access-${tokenRequests}`, expires_in: 120 });
      }
      return json({ historyId: "99" });
    });
    const reader = new GoogleGmailReadPort(
      { clientId: "client", clientSecret: "secret" },
      { fetcher, now: () => now },
    );

    await reader.getProfileHistoryId({ refreshToken: "refresh" });
    now = new Date(now.valueOf() + 30_000);
    await reader.getProfileHistoryId({ refreshToken: "refresh" });
    expect(tokenRequests).toBe(1);
    now = new Date(now.valueOf() + 31_000);
    await reader.getProfileHistoryId({ refreshToken: "refresh" });
    expect(tokenRequests).toBe(2);
  });

  it("maps an expired history cursor to the dedicated gap error", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString());
      return url.hostname === "oauth2.googleapis.com"
        ? json({ access_token: "access" })
        : json({ error: { message: "HistoryId too old" } }, 404);
    });
    const reader = new GoogleGmailReadPort(
      { clientId: "client", clientSecret: "secret" },
      { fetcher },
    );

    await expect(
      reader.listHistory({
        refreshToken: "refresh",
        startHistoryId: "expired",
        pageToken: null,
      }),
    ).rejects.toBeInstanceOf(GmailHistoryGapError);
  });

  it("parses recursive text/plain parts and never stores Gmail HTML", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString());
      if (url.hostname === "oauth2.googleapis.com") {
        return json({ access_token: "access" });
      }
      return json({
        id: "thread-1",
        historyId: "222",
        messages: [
          {
            id: "message-1",
            internalDate: "1788440000000",
            payload: {
              mimeType: "multipart/alternative",
              headers: [
                { name: "From", value: "Recruiter <recruiter@example.com>" },
                { name: "To", value: "Owner <owner@example.com>" },
                { name: "Subject", value: "Interview availability" },
                { name: "Message-ID", value: "<message-1@example.com>" },
              ],
              parts: [
                {
                  mimeType: "multipart/mixed",
                  parts: [
                    { mimeType: "text/plain", body: { data: base64url("Plain answer") } },
                    { mimeType: "application/pdf", body: { attachmentId: "attachment" } },
                  ],
                },
                {
                  mimeType: "text/html",
                  body: { data: base64url("<script>unsafe()</script><p>HTML answer</p>") },
                },
              ],
            },
          },
        ],
      });
    });
    const reader = new GoogleGmailReadPort(
      { clientId: "client", clientSecret: "secret" },
      { fetcher },
    );

    const thread = await reader.getThread({
      refreshToken: "refresh",
      gmailThreadId: "thread-1",
    });
    expect(thread).toEqual({
      gmailThreadId: "thread-1",
      historyId: "222",
      messages: [
        {
          gmailId: "message-1",
          rfcMessageId: "<message-1@example.com>",
          fromEmail: "recruiter@example.com",
          to: ["owner@example.com"],
          subject: "Interview availability",
          body: "Plain answer",
          deliveryStatusText: null,
          failedRecipients: [],
          sentAt: new Date(1788440000000),
        },
      ],
    });
    expect(JSON.stringify(thread)).not.toContain("unsafe");
    expect(JSON.stringify(thread)).not.toContain("HTML answer");
  });

  it("extracts a message/delivery-status part and X-Failed-Recipients", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString());
      if (url.hostname === "oauth2.googleapis.com") {
        return json({ access_token: "access" });
      }
      return json({
        id: "thread-bounce",
        historyId: "301",
        messages: [
          {
            id: "bounce-1",
            internalDate: "1788440000000",
            payload: {
              mimeType: "multipart/report",
              headers: [
                {
                  name: "From",
                  value: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
                },
                { name: "To", value: "Owner <owner@invalid.test>" },
                {
                  name: "Subject",
                  value: "Delivery Status Notification (Failure)",
                },
                { name: "X-Failed-Recipients", value: "priya@invalid.test" },
              ],
              parts: [
                {
                  mimeType: "text/plain",
                  body: { data: base64url("Address not found\n550 mailbox unavailable") },
                },
                {
                  mimeType: "message/delivery-status",
                  body: {
                    data: base64url(
                      "Final-Recipient: rfc822; priya@invalid.test\r\nAction: failed\r\nStatus: 5.1.1\r\n",
                    ),
                  },
                },
                {
                  mimeType: "text/html",
                  body: { data: base64url("<p>ignored html bounce</p>") },
                },
              ],
            },
          },
        ],
      });
    });
    const reader = new GoogleGmailReadPort(
      { clientId: "client", clientSecret: "secret" },
      { fetcher },
    );

    const thread = await reader.getThread({
      refreshToken: "refresh",
      gmailThreadId: "thread-bounce",
    });
    expect(thread.messages[0]).toMatchObject({
      fromEmail: "mailer-daemon@googlemail.com",
      failedRecipients: ["priya@invalid.test"],
      deliveryStatusText:
        "Final-Recipient: rfc822; priya@invalid.test\r\nAction: failed\r\nStatus: 5.1.1",
      body: "Address not found\n550 mailbox unavailable",
    });
    expect(JSON.stringify(thread)).not.toContain("ignored html bounce");
  });

  it("uses Cc, Bcc and Delivered-To when To has no address", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString());
      if (url.hostname === "oauth2.googleapis.com") {
        return json({ access_token: "access" });
      }
      return json({
        id: "thread-2",
        historyId: "223",
        messages: [
          {
            id: "message-2",
            internalDate: "1788440000000",
            payload: {
              headers: [
                { name: "From", value: "Sender <sender@example.com>" },
                { name: "To", value: "undisclosed-recipients:;" },
                { name: "Cc", value: "Copy <copy@example.com>" },
                { name: "Bcc", value: "Blind <blind@example.com>" },
                { name: "Delivered-To", value: "owner@example.com" },
              ],
            },
          },
        ],
      });
    });
    const reader = new GoogleGmailReadPort(
      { clientId: "client", clientSecret: "secret" },
      { fetcher },
    );

    const thread = await reader.getThread({
      refreshToken: "refresh",
      gmailThreadId: "thread-2",
    });
    expect(thread.messages[0].to).toEqual([
      "copy@example.com",
      "blind@example.com",
      "owner@example.com",
    ]);
  });

  it("fails closed on token, rate-limit and malformed Gmail responses", async () => {
    const tokenFailure = new GoogleGmailReadPort(
      { clientId: "client", clientSecret: "secret" },
      { fetcher: async () => json({ error: "invalid_grant" }, 400) },
    );
    await expect(
      tokenFailure.getProfileHistoryId({ refreshToken: "refresh" }),
    ).rejects.toBeInstanceOf(GoogleGmailReadError);

    const rateLimited = new GoogleGmailReadPort(
      { clientId: "client", clientSecret: "secret" },
      {
        fetcher: async (input) =>
          new URL(input.toString()).hostname === "oauth2.googleapis.com"
            ? json({ access_token: "access" })
            : json({ error: "rate limited" }, 429),
      },
    );
    await expect(
      rateLimited.listThreads({
        refreshToken: "refresh",
        query: "jobs",
        maxResults: 10,
        pageToken: null,
      }),
    ).rejects.toBeInstanceOf(GoogleGmailReadError);

    const quotaLimited = new GoogleGmailReadPort(
      { clientId: "client", clientSecret: "secret" },
      {
        fetcher: async (input) =>
          new URL(input.toString()).hostname === "oauth2.googleapis.com"
            ? json({ access_token: "access" })
            : json(
                { error: { errors: [{ reason: "userRateLimitExceeded" }] } },
                403,
              ),
      },
    );
    await expect(
      quotaLimited.listThreads({
        refreshToken: "refresh",
        query: "jobs",
        maxResults: 10,
        pageToken: null,
      }),
    ).rejects.toMatchObject({ retryable: true });
  });
});
