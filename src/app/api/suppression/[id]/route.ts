import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { removeSuppressionEntry } from "@/server/repos/send-safety";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const result = removeSuppressionEntry(
    getDatabase(),
    tenant,
    (await context.params).id,
  );
  if (result.removed) return NextResponse.json({ ok: true });
  return NextResponse.json({ error: result.error }, { status: result.status });
}
