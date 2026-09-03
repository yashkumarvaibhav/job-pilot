import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  InboxSyncError,
  runMailboxRecoveryBatch,
  syncInboxAccount,
} from "@/server/mail/inbox-sync";
import { GoogleGmailReadError } from "@/server/mail/google-read";
import { getMailReadDependencies } from "@/server/mail/runtime";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const dependencies = getMailReadDependencies();
  if (!dependencies) {
    return NextResponse.json(
      { error: "Gmail inbox sync is not configured yet." },
      { status: 503 },
    );
  }
  const { id } = await context.params;
  try {
    const database = getDatabase();
    const sync = await syncInboxAccount(database, tenant, id, dependencies);
    const recovery = sync.historyGap
      ? await runMailboxRecoveryBatch(database, tenant, id, {
          ...dependencies,
          tickId: randomUUID(),
        })
      : null;
    return NextResponse.json({ sync, recovery });
  } catch (error) {
    if (error instanceof InboxSyncError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof GoogleGmailReadError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}
