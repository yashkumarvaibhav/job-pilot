import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  ComposeSendError,
  sendComposedEmail,
  type SendComposedEmailInput,
} from "@/server/mail/compose-service";
import { GoogleMailSendError } from "@/server/mail/google-send";
import { getMailSendDependencies } from "@/server/mail/runtime";

export const runtime = "nodejs";

const ALLOWED_KEYS = new Set([
  "accountId",
  "contactId",
  "opportunityId",
  "referralId",
  "subject",
  "body",
  "attachmentVersionIds",
  "approval",
]);

async function readInput(request: Request): Promise<SendComposedEmailInput | null> {
  try {
    const value: unknown = await request.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some((key) => !ALLOWED_KEYS.has(key))) return null;
    if (
      typeof input.accountId !== "string" ||
      typeof input.contactId !== "string" ||
      typeof input.subject !== "string" ||
      typeof input.body !== "string" ||
      input.approval !== "send_now" ||
      (input.opportunityId !== undefined &&
        input.opportunityId !== null &&
        typeof input.opportunityId !== "string") ||
      (input.referralId !== undefined &&
        input.referralId !== null &&
        typeof input.referralId !== "string") ||
      !Array.isArray(input.attachmentVersionIds) ||
      input.attachmentVersionIds.some((id) => typeof id !== "string")
    ) {
      return null;
    }
    return input as SendComposedEmailInput;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }
  const input = await readInput(request);
  if (!input) {
    return NextResponse.json(
      { error: "Review a valid email before choosing Send now." },
      { status: 400 },
    );
  }
  const dependencies = getMailSendDependencies();
  if (!dependencies) {
    return NextResponse.json(
      { error: "Gmail sending is not configured yet." },
      { status: 503 },
    );
  }
  try {
    const sent = await sendComposedEmail(
      getDatabase(),
      tenant,
      input,
      dependencies,
    );
    return NextResponse.json(sent, { status: 201 });
  } catch (error) {
    if (error instanceof ComposeSendError) {
      const status = error.message.endsWith("not found.") ? 404 : 409;
      return NextResponse.json({ error: error.message }, { status });
    }
    if (error instanceof GoogleMailSendError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}
