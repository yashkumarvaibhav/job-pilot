import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type { TenantContext } from "../db/tenant";
import { decodeTokenKey } from "./token-crypto";

export const GMAIL_OAUTH_STATE_COOKIE = "job_pilot_gmail_oauth";
export const GMAIL_OAUTH_STATE_TTL_MS = 10 * 60 * 1_000;

export type GmailOAuthIntent =
  | { kind: "connect" }
  | { kind: "reconnect"; accountId: string };

type StatePayload = {
  version: 1;
  userId: string;
  workspaceId: string;
  sessionDigest: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  intent: GmailOAuthIntent;
};

export class GmailOAuthStateError extends Error {
  constructor() {
    super("This Gmail connection attempt is invalid or expired. Start again.");
    this.name = "GmailOAuthStateError";
  }
}

function digestSession(sessionToken: string): string {
  return createHash("sha256").update(sessionToken).digest("base64url");
}

function signature(payload: string, tokenKey: string): string {
  return createHmac("sha256", decodeTokenKey(tokenKey))
    .update(payload)
    .digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function validIntent(value: unknown): value is GmailOAuthIntent {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  if (value.kind === "connect") {
    return true;
  }
  return (
    value.kind === "reconnect" &&
    "accountId" in value &&
    typeof value.accountId === "string" &&
    value.accountId.trim().length > 0
  );
}

export function createGmailOAuthState(input: {
  tenant: TenantContext;
  sessionToken: string;
  tokenKey: string;
  intent: GmailOAuthIntent;
  now?: Date;
}): { state: string; cookieValue: string; expiresAt: Date } {
  if (input.sessionToken.length === 0) {
    throw new GmailOAuthStateError();
  }
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + GMAIL_OAUTH_STATE_TTL_MS);
  const nonce = randomBytes(32).toString("base64url");
  const payload: StatePayload = {
    version: 1,
    userId: input.tenant.userId,
    workspaceId: input.tenant.workspaceId,
    sessionDigest: digestSession(input.sessionToken),
    nonce,
    issuedAt: now.getTime(),
    expiresAt: expiresAt.getTime(),
    intent: input.intent,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    state: `${encoded}.${signature(encoded, input.tokenKey)}`,
    cookieValue: nonce,
    expiresAt,
  };
}

export function validateGmailOAuthState(input: {
  state: string | undefined | null;
  cookieValue: string | undefined | null;
  tenant: TenantContext;
  sessionToken: string;
  tokenKey: string;
  now?: Date;
}): GmailOAuthIntent {
  try {
    if (!input.state || !input.cookieValue || !input.sessionToken) {
      throw new Error("missing state");
    }
    const parts = input.state.split(".");
    if (parts.length !== 2 || !safeEqual(parts[1], signature(parts[0], input.tokenKey))) {
      throw new Error("invalid signature");
    }
    const payload = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    ) as Partial<StatePayload>;
    const now = (input.now ?? new Date()).getTime();
    if (
      payload.version !== 1 ||
      payload.userId !== input.tenant.userId ||
      payload.workspaceId !== input.tenant.workspaceId ||
      payload.sessionDigest !== digestSession(input.sessionToken) ||
      typeof payload.nonce !== "string" ||
      !safeEqual(payload.nonce, input.cookieValue) ||
      typeof payload.issuedAt !== "number" ||
      typeof payload.expiresAt !== "number" ||
      payload.issuedAt > now + 30_000 ||
      payload.expiresAt < now ||
      payload.expiresAt - payload.issuedAt !== GMAIL_OAUTH_STATE_TTL_MS ||
      !validIntent(payload.intent)
    ) {
      throw new Error("invalid payload");
    }
    return payload.intent;
  } catch {
    throw new GmailOAuthStateError();
  }
}
