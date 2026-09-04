import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { enrollmentJson } from "@/server/repos/sequence-http";
import { stopEnrollment } from "@/server/repos/sequences";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const stopped = stopEnrollment(
    getDatabase(),
    tenant,
    (await context.params).id,
  );
  return stopped
    ? NextResponse.json(enrollmentJson(stopped))
    : NextResponse.json({ error: "Enrollment not found." }, { status: 404 });
}
