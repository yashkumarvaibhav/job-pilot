import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  DocumentInputError,
  deleteDocumentVersion,
  getDocumentVersion,
} from "@/server/repos/documents";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ versionId: string }> };

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const NOT_FOUND = { error: "Document version not found" };

export async function DELETE(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const { versionId } = await context.params;
  const database = getDatabase();
  if (!getDocumentVersion(database, tenant, versionId)) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }
  try {
    deleteDocumentVersion(database, tenant, versionId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof DocumentInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
