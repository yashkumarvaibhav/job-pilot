import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { deleteTag } from "@/server/repos/tags";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const TAG_NOT_FOUND = { error: "Tag not found" };

export async function DELETE(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const { id } = await context.params;
  return deleteTag(getDatabase(), tenant, id)
    ? new Response(null, { status: 204 })
    : NextResponse.json(TAG_NOT_FOUND, { status: 404 });
}
