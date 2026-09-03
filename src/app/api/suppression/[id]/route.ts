import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { removeManualSuppression } from "@/server/repos/send-safety";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  return removeManualSuppression(
    getDatabase(),
    tenant,
    (await context.params).id,
  )
    ? NextResponse.json({ ok: true })
    : NextResponse.json(
        { error: "Removable suppression entry not found." },
        { status: 404 },
      );
}
