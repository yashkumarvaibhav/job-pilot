import { describe, expect, it, vi } from "vitest";

import type { MailSendRequest } from "./mail-port";
import { buildRawGmailMessage, GoogleGmailMailPort } from "./google-send";

const request: MailSendRequest = {
  accountId: "account-a",
  refreshToken: "synthetic-refresh",
  fromEmail: "sender@invalid.test",
  senderName: "Yash Kumar",
  replyTo: "reply@invalid.test",
  to: ["rahul@invalid.test"],
  subject: "Referral request — SDE",
  body: "Hello Rahul,\n\nCould we discuss the role?",
  attachments: [
    {
      id: "version-1",
      filename: "resume.pdf",
      contentType: "application/pdf",
      bytes: Buffer.from("synthetic-pdf"),
    },
  ],
};

describe("Google Gmail send port", () => {
  it("builds an RFC message with plain text and attachments", () => {
    const raw = buildRawGmailMessage(
      request,
      "job-pilot-boundary",
      "<message@jobpilot.invalid>",
    );
    const message = Buffer.from(raw, "base64url").toString("utf8");

    expect(message).toContain("From: =?UTF-8?B?");
    expect(message).toContain("<sender@invalid.test>");
    expect(message).toContain("Reply-To: reply@invalid.test");
    expect(message).toContain("To: rahul@invalid.test");
    expect(message).toContain("Message-ID: <message@jobpilot.invalid>");
    expect(message).toContain('boundary="job-pilot-boundary"');
    expect(message).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(message).toContain('Content-Disposition: attachment; filename="resume.pdf"');
    expect(message).toContain(Buffer.from(request.body).toString("base64"));
    expect(message).toContain(Buffer.from("synthetic-pdf").toString("base64"));
    expect(message).not.toContain("synthetic-refresh");
  });

  it("refreshes the selected account token and sends through Gmail", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "synthetic-access" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "gmail-message", threadId: "gmail-thread" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const port = new GoogleGmailMailPort(
      { clientId: "client-id", clientSecret: "client-secret" },
      {
        fetcher,
        now: () => new Date("2026-09-03T15:00:00.000Z"),
        randomId: () => "fixed-id",
      },
    );

    await expect(port.send({ ...request, attachments: [] })).resolves.toEqual({
      gmailMessageId: "gmail-message",
      gmailThreadId: "gmail-thread",
      rfcMessageId: null,
      sentAt: new Date("2026-09-03T15:00:00.000Z"),
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
    const gmailOptions = fetcher.mock.calls[1][1] as RequestInit;
    expect(fetcher.mock.calls[1][0]).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    );
    expect(gmailOptions.headers).toEqual(
      expect.objectContaining({ authorization: "Bearer synthetic-access" }),
    );
    expect(String(gmailOptions.body)).not.toContain("synthetic-refresh");
  });

  it("does not claim that Gmail preserved a caller-supplied queue Message-ID", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "synthetic-access" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "gmail-message", threadId: "gmail-thread" }),
          { status: 200 },
        ),
      );
    const port = new GoogleGmailMailPort(
      { clientId: "client-id", clientSecret: "client-secret" },
      { fetcher, randomId: () => "mime-boundary" },
    );

    const result = await port.send({
      ...request,
      attachments: [],
      rfcMessageId: "<jp-queue-1@invalid.test>",
    });
    const sendBody = JSON.parse(
      String((fetcher.mock.calls[1][1] as RequestInit).body),
    ) as { raw: string };
    const mime = Buffer.from(sendBody.raw, "base64url").toString("utf8");
    expect(mime).toContain("Message-ID: <jp-queue-1@invalid.test>");
    expect(result.rfcMessageId).toBeNull();
  });

  it("fails without repeating Google response or credential details", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "contains-sensitive-detail" }), {
        status: 400,
      }),
    );
    const port = new GoogleGmailMailPort(
      { clientId: "client-id", clientSecret: "client-secret" },
      { fetcher },
    );

    await expect(port.send(request)).rejects.toThrow(
      "Gmail could not send this email. Reconnect the selected account and retry.",
    );
    try {
      await port.send(request);
    } catch (error) {
      expect(String(error)).not.toContain("contains-sensitive-detail");
      expect(String(error)).not.toContain("synthetic-refresh");
    }
  });
});
