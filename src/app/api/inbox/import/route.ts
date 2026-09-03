import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { GoogleGmailReadError } from "@/server/mail/google-read";
import { getMailReadDependencies } from "@/server/mail/runtime";
import {
  InboxContentError,
  importGmailThread,
} from "@/server/repos/inbox-content";

export const runtime = "nodejs";

function nullableString(value: unknown) {
  return value === undefined || value === null || typeof value === "string";
}

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const dependencies = getMailReadDependencies();
  if (!dependencies) {
    return NextResponse.json(
      { error: "Gmail thread import is not configured yet." },
      { status: 503 },
    );
  }
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    input = null;
  }
  const value = input as Record<string, unknown> | null;
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.accountId !== "string" ||
    typeof value.gmailThreadId !== "string" ||
    !nullableString(value.contactId) ||
    !nullableString(value.opportunityId) ||
    !nullableString(value.referralId) ||
    Object.keys(value).some(
      (key) =>
        ![
          "accountId",
          "gmailThreadId",
          "contactId",
          "opportunityId",
          "referralId",
        ].includes(key),
    )
  ) {
    return NextResponse.json(
      { error: "Choose one Gmail thread to import." },
      { status: 400 },
    );
  }
  try {
    const thread = await importGmailThread(
      getDatabase(),
      tenant,
      value as {
        accountId: string;
        gmailThreadId: string;
        contactId?: string | null;
        opportunityId?: string | null;
        referralId?: string | null;
      },
      dependencies,
    );
    return NextResponse.json({ thread }, { status: 201 });
  } catch (error) {
    if (error instanceof InboxContentError) {
      const status = error.message.endsWith("not found.") ? 404 : 409;
      return NextResponse.json({ error: error.message }, { status });
    }
    if (error instanceof GoogleGmailReadError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}
