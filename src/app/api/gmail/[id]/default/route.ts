import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { setDefaultEmailAccount } from "@/server/repos/email-accounts";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }
  const { id } = await context.params;
  if (!setDefaultEmailAccount(getDatabase(), tenant, id)) {
    return NextResponse.json({ error: "Gmail account not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
