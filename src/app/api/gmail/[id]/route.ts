import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  EmailAccountInputError,
  updateEmailAccountSettings,
  type UpdateEmailAccountSettingsInput,
} from "@/server/repos/email-accounts";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const ALLOWED_KEYS = new Set([
  "senderName",
  "signature",
  "replyTo",
  "dailyLimit",
  "sendingWindowStart",
  "sendingWindowEnd",
]);

async function readInput(
  request: Request,
): Promise<UpdateEmailAccountSettingsInput | null> {
  try {
    const value: unknown = await request.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const input = value as Record<string, unknown>;
    const keys = Object.keys(input);
    if (keys.length === 0 || keys.some((key) => !ALLOWED_KEYS.has(key))) {
      return null;
    }
    if (
      (input.senderName !== undefined && typeof input.senderName !== "string") ||
      (input.signature !== undefined &&
        input.signature !== null &&
        typeof input.signature !== "string") ||
      (input.replyTo !== undefined &&
        input.replyTo !== null &&
        typeof input.replyTo !== "string") ||
      (input.dailyLimit !== undefined && typeof input.dailyLimit !== "number") ||
      (input.sendingWindowStart !== undefined &&
        typeof input.sendingWindowStart !== "number") ||
      (input.sendingWindowEnd !== undefined &&
        typeof input.sendingWindowEnd !== "number")
    ) {
      return null;
    }
    return input as UpdateEmailAccountSettingsInput;
  } catch {
    return null;
  }
}

export async function PATCH(request: Request, context: RouteContext) {
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
      { error: "Choose valid Gmail account settings to update." },
      { status: 400 },
    );
  }
  const { id } = await context.params;
  try {
    const account = updateEmailAccountSettings(
      getDatabase(),
      tenant,
      id,
      input,
    );
    return account
      ? NextResponse.json(account)
      : NextResponse.json({ error: "Gmail account not found." }, { status: 404 });
  } catch (error) {
    if (error instanceof EmailAccountInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
