import { randomUUID } from "node:crypto";

import type {
  MailPort,
  MailSendRequest,
  MailSendResult,
} from "./mail-port";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

type GoogleClient = { clientId: string; clientSecret: string };

type GoogleGmailMailPortOptions = {
  fetcher?: typeof fetch;
  now?: () => Date;
  randomId?: () => string;
};

export class GoogleMailSendError extends Error {
  constructor() {
    super(
      "Gmail could not send this email. Reconnect the selected account and retry.",
    );
    this.name = "GoogleMailSendError";
  }
}

function headerValue(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function safeFilename(value: string): string {
  const safe = value
    .replace(/[\r\n]/g, "")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_")
    .trim();
  return safe || "attachment";
}

function safeContentType(value: string): string {
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(value)
    ? value
    : "application/octet-stream";
}

function wrappedBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/.{1,76}/g, "$&\r\n")
    .trimEnd();
}

export function buildRawGmailMessage(
  request: MailSendRequest,
  boundary: string,
  rfcMessageId: string,
): string {
  const from = request.senderName.trim()
    ? `${headerValue(request.senderName.trim())} <${request.fromEmail}>`
    : request.fromEmail;
  const headers = [
    `From: ${from}`,
    `To: ${request.to.join(", ")}`,
    `Subject: ${headerValue(request.subject)}`,
    `Message-ID: ${rfcMessageId}`,
    "MIME-Version: 1.0",
  ];
  if (request.replyTo) headers.splice(2, 0, `Reply-To: ${request.replyTo}`);

  let message: string;
  if (request.attachments.length === 0) {
    message = [
      ...headers,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrappedBase64(Buffer.from(request.body, "utf8")),
    ].join("\r\n");
  } else {
    const parts = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrappedBase64(Buffer.from(request.body, "utf8")),
    ];
    for (const attachment of request.attachments) {
      const filename = safeFilename(attachment.filename);
      parts.push(
        `--${boundary}`,
        `Content-Type: ${safeContentType(attachment.contentType)}; name="${filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${filename}"`,
        "",
        wrappedBase64(attachment.bytes),
      );
    }
    parts.push(`--${boundary}--`);
    message = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      ...parts,
    ].join("\r\n");
  }
  return Buffer.from(message, "utf8").toString("base64url");
}

async function jsonObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export class GoogleGmailMailPort implements MailPort {
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly randomId: () => string;

  constructor(
    private readonly client: GoogleClient,
    options: GoogleGmailMailPortOptions = {},
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? randomUUID;
  }

  async send(request: MailSendRequest): Promise<MailSendResult> {
    const tokenResponse = await this.fetcher(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.client.clientId,
        client_secret: this.client.clientSecret,
        refresh_token: request.refreshToken,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
    });
    const tokenBody = await jsonObject(tokenResponse);
    if (!tokenResponse.ok || typeof tokenBody.access_token !== "string") {
      throw new GoogleMailSendError();
    }

    const id = this.randomId();
    const rfcMessageId = `<${id}@jobpilot.invalid>`;
    const raw = buildRawGmailMessage(request, `job-pilot-${id}`, rfcMessageId);
    const sendResponse = await this.fetcher(SEND_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokenBody.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw }),
      cache: "no-store",
    });
    const sendBody = await jsonObject(sendResponse);
    if (
      !sendResponse.ok ||
      typeof sendBody.id !== "string" ||
      !sendBody.id ||
      typeof sendBody.threadId !== "string" ||
      !sendBody.threadId
    ) {
      throw new GoogleMailSendError();
    }
    return {
      gmailMessageId: sendBody.id,
      gmailThreadId: sendBody.threadId,
      rfcMessageId,
      sentAt: this.now(),
    };
  }
}
