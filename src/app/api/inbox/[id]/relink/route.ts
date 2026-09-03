import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  InboxContentError,
  relinkInboxThread,
} from "@/server/repos/inbox-content";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
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
    typeof value.contactId !== "string" ||
    (value.opportunityId != null && typeof value.opportunityId !== "string") ||
    (value.referralId != null && typeof value.referralId !== "string") ||
    Object.keys(value).some(
      (key) => !["contactId", "opportunityId", "referralId"].includes(key),
    )
  ) {
    return NextResponse.json({ error: "Choose a contact to link." }, { status: 400 });
  }
  const { id } = await context.params;
  try {
    const thread = relinkInboxThread(getDatabase(), tenant, id, {
      contactId: value.contactId,
      opportunityId: (value.opportunityId as string | null | undefined) ?? null,
      referralId: (value.referralId as string | null | undefined) ?? null,
    });
    return thread
      ? NextResponse.json({ thread })
      : NextResponse.json({ error: "Inbox thread not found." }, { status: 404 });
  } catch (error) {
    if (error instanceof InboxContentError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
