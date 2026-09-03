import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { GoogleGmailReadError } from "@/server/mail/google-read";
import { getMailReadDependencies } from "@/server/mail/runtime";
import {
  InboxContentError,
  searchGmailThreads,
} from "@/server/repos/inbox-content";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const dependencies = getMailReadDependencies();
  if (!dependencies) {
    return NextResponse.json(
      { error: "Gmail inbox search is not configured yet." },
      { status: 503 },
    );
  }
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    input = null;
  }
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    typeof (input as Record<string, unknown>).accountId !== "string" ||
    typeof (input as Record<string, unknown>).query !== "string" ||
    Object.keys(input).some((key) => !["accountId", "query"].includes(key))
  ) {
    return NextResponse.json(
      { error: "Choose an account and enter a Gmail search query." },
      { status: 400 },
    );
  }
  try {
    const results = await searchGmailThreads(
      getDatabase(),
      tenant,
      input as { accountId: string; query: string },
      dependencies,
    );
    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof InboxContentError) {
      const status = error.message === "Gmail account not found." ? 404 : 409;
      return NextResponse.json({ error: error.message }, { status });
    }
    if (error instanceof GoogleGmailReadError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}
