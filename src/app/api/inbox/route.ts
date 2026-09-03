import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { getInboxThread, listInboxThreads } from "@/server/repos/inbox-content";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const url = new URL(request.url);
  const threadId = url.searchParams.get("threadId")?.trim();
  const accountId = url.searchParams.get("accountId")?.trim() || undefined;
  const database = getDatabase();
  if (threadId) {
    const thread = getInboxThread(database, tenant, threadId);
    return thread
      ? NextResponse.json({ thread })
      : NextResponse.json({ error: "Inbox thread not found." }, { status: 404 });
  }
  return NextResponse.json({ threads: listInboxThreads(database, tenant, accountId) });
}
