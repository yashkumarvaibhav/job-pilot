import { createHash } from "node:crypto";

import { normalizeEmail } from "../auth/email";
import {
  GmailHistoryGapError,
  type GmailMessageSnapshot,
  type GmailReadPort,
  type GmailThreadSnapshot,
} from "./gmail-read-port";
import {
  GMAIL_SYNC_LIMITS,
} from "./inbox-sync";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";

type GoogleClient = { clientId: string; clientSecret: string };
type GoogleGmailReadOptions = { fetcher?: typeof fetch; now?: () => Date };

type JsonObject = Record<string, unknown>;

export class GoogleGmailReadError extends Error {
  readonly retryable: boolean;

  constructor(retryable = false) {
    super(
      retryable
        ? "Gmail is temporarily unavailable. Retry this account's sync."
        : "Gmail could not be read. Reconnect this account and retry.",
    );
    this.name = "GoogleGmailReadError";
    this.retryable = retryable;
  }
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

async function responseObject(response: Response): Promise<JsonObject> {
  try {
    return object(await response.json()) ?? {};
  } catch {
    return {};
  }
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  return signal ?? AbortSignal.timeout(GMAIL_SYNC_LIMITS.requestDeadlineMs);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function arrayObjects(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.map(object).filter((item): item is JsonObject => item !== null)
    : [];
}

function retryableGoogleResponse(response: Response, body: JsonObject): boolean {
  if (response.status === 429 || response.status >= 500) return true;
  if (response.status !== 403) return false;
  const error = object(body.error);
  const reasons = arrayObjects(error?.errors)
    .map((item) => stringValue(item.reason))
    .filter((reason): reason is string => reason !== null);
  return reasons.some((reason) =>
    ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"].includes(
      reason,
    ),
  );
}

function refreshTokenCacheKey(refreshToken: string): string {
  return createHash("sha256").update(refreshToken, "utf8").digest("hex");
}

function decodeBase64url(value: unknown): string {
  const encoded = stringValue(value);
  if (encoded === null) return "";
  try {
    return Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function plainTextParts(part: JsonObject): string[] {
  const mimeType = stringValue(part.mimeType)?.toLowerCase();
  const body = object(part.body);
  if (mimeType === "text/plain") {
    const text = decodeBase64url(body?.data);
    return text ? [text] : [];
  }
  if (mimeType === "text/html") return [];
  return arrayObjects(part.parts).flatMap(plainTextParts);
}

function headers(payload: JsonObject): Map<string, string> {
  const result = new Map<string, string>();
  for (const header of arrayObjects(payload.headers)) {
    const name = stringValue(header.name)?.toLowerCase();
    const value = stringValue(header.value);
    if (name && value && !result.has(name)) result.set(name, value);
  }
  return result;
}

function emailFromHeader(value: string | undefined): string | null {
  if (!value) return null;
  const angle = value.match(/<([^<>]+)>/);
  return normalizeEmail(angle?.[1] ?? value);
}

function emailsFromHeader(value: string | undefined): string[] {
  if (!value) return [];
  const matches = [...value.matchAll(/<([^<>]+)>|([^,\s]+@[^,\s]+)/g)];
  const values = matches
    .map((match) => normalizeEmail(match[1] ?? match[2] ?? ""))
    .filter((email): email is string => email !== null);
  if (values.length > 0) return [...new Set(values)];
  const single = normalizeEmail(value);
  return single ? [single] : [];
}

function parseMessage(value: JsonObject): GmailMessageSnapshot | null {
  const gmailId = stringValue(value.id);
  const payload = object(value.payload);
  if (!gmailId || !payload) return null;
  const fields = headers(payload);
  const fromEmail = emailFromHeader(fields.get("from"));
  const to = [
    ...new Set(
      ["to", "cc", "bcc", "delivered-to"].flatMap((name) =>
        emailsFromHeader(fields.get(name)),
      ),
    ),
  ];
  const milliseconds = Number(stringValue(value.internalDate));
  const sentAt = new Date(milliseconds);
  if (!fromEmail || to.length === 0 || Number.isNaN(sentAt.valueOf())) return null;
  return {
    gmailId,
    rfcMessageId: fields.get("message-id") ?? null,
    fromEmail,
    to,
    subject: fields.get("subject") ?? "",
    body: plainTextParts(payload).join("\n\n").trim(),
    sentAt,
  };
}

export class GoogleGmailReadPort implements GmailReadPort {
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly accessTokens = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  constructor(
    private readonly client: GoogleClient,
    options: GoogleGmailReadOptions = {},
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  private async accessToken(refreshToken: string, signal?: AbortSignal) {
    const cacheKey = refreshTokenCacheKey(refreshToken);
    const cached = this.accessTokens.get(cacheKey);
    if (cached && cached.expiresAt > this.now().valueOf()) return cached.token;
    const response = await this.fetcher(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.client.clientId,
        client_secret: this.client.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
      signal: requestSignal(signal),
    });
    const body = await responseObject(response);
    const token = stringValue(body.access_token);
    if (!response.ok || token === null) {
      throw new GoogleGmailReadError(retryableGoogleResponse(response, body));
    }
    const expiresIn = Number(body.expires_in);
    const lifetimeSeconds =
      Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600;
    this.accessTokens.set(cacheKey, {
      token,
      expiresAt:
        this.now().valueOf() + Math.max(1, lifetimeSeconds - 60) * 1_000,
    });
    return token;
  }

  private async gmail(
    path: string,
    refreshToken: string,
    signal?: AbortSignal,
  ): Promise<{ response: Response; body: JsonObject }> {
    const accessToken = await this.accessToken(refreshToken, signal);
    const response = await this.fetcher(`${GMAIL_BASE_URL}${path}`, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: requestSignal(signal),
    });
    return { response, body: await responseObject(response) };
  }

  async getProfileHistoryId(input: {
    refreshToken: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const { response, body } = await this.gmail(
      "/profile",
      input.refreshToken,
      input.signal,
    );
    const historyId = stringValue(body.historyId);
    if (!response.ok || historyId === null) {
      throw new GoogleGmailReadError(retryableGoogleResponse(response, body));
    }
    return historyId;
  }

  async listHistory(input: {
    refreshToken: string;
    startHistoryId: string;
    pageToken: string | null;
    signal?: AbortSignal;
  }) {
    const query = new URLSearchParams({
      startHistoryId: input.startHistoryId,
      historyTypes: "messageAdded",
      maxResults: "100",
    });
    if (input.pageToken) query.set("pageToken", input.pageToken);
    const { response, body } = await this.gmail(
      `/history?${query.toString()}`,
      input.refreshToken,
      input.signal,
    );
    if (response.status === 404) throw new GmailHistoryGapError();
    const historyId = stringValue(body.historyId);
    if (!response.ok || historyId === null) {
      throw new GoogleGmailReadError(retryableGoogleResponse(response, body));
    }
    const threadIds = arrayObjects(body.history).flatMap((history) =>
      arrayObjects(history.messagesAdded)
        .map((added) => stringValue(object(added.message)?.threadId))
        .filter((id): id is string => id !== null),
    );
    return {
      historyId,
      threadIds: [...new Set(threadIds)],
      nextPageToken: stringValue(body.nextPageToken),
    };
  }

  async listThreads(input: {
    refreshToken: string;
    query: string;
    maxResults: number;
    pageToken: string | null;
    signal?: AbortSignal;
  }) {
    const query = new URLSearchParams({
      q: input.query,
      maxResults: String(Math.max(1, Math.min(100, Math.trunc(input.maxResults)))),
    });
    if (input.pageToken) query.set("pageToken", input.pageToken);
    const { response, body } = await this.gmail(
      `/threads?${query.toString()}`,
      input.refreshToken,
      input.signal,
    );
    if (!response.ok) {
      throw new GoogleGmailReadError(retryableGoogleResponse(response, body));
    }
    return {
      threadIds: arrayObjects(body.threads)
        .map((thread) => stringValue(thread.id))
        .filter((id): id is string => id !== null),
      nextPageToken: stringValue(body.nextPageToken),
    };
  }

  async getThread(input: {
    refreshToken: string;
    gmailThreadId: string;
    signal?: AbortSignal;
  }): Promise<GmailThreadSnapshot> {
    const query = new URLSearchParams({ format: "full" });
    const { response, body } = await this.gmail(
      `/threads/${encodeURIComponent(input.gmailThreadId)}?${query.toString()}`,
      input.refreshToken,
      input.signal,
    );
    const gmailThreadId = stringValue(body.id);
    const historyId = stringValue(body.historyId);
    const messages = arrayObjects(body.messages)
      .map(parseMessage)
      .filter((message): message is GmailMessageSnapshot => message !== null);
    if (!response.ok || gmailThreadId === null || historyId === null || messages.length === 0) {
      throw new GoogleGmailReadError(retryableGoogleResponse(response, body));
    }
    return { gmailThreadId, historyId, messages };
  }
}
