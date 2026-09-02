import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { readDocumentVersionFile } from "@/server/repos/documents";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ versionId: string }> };

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const NOT_FOUND = { error: "Document version not found" };

/**
 * The only way stored bytes leave the server. No session is a 401; another
 * workspace's id is the same 404 as an id that never existed, so the response
 * never reveals that a file exists somewhere else.
 */
export async function GET(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const { versionId } = await context.params;
  const found = readDocumentVersionFile(getDatabase(), tenant, versionId);
  if (!found) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  const filename = (found.version.originalFilename ?? `${found.version.label}`)
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 100);

  return new NextResponse(new Uint8Array(found.bytes), {
    status: 200,
    headers: {
      "content-type": found.version.contentType,
      "content-length": String(found.version.byteSize),
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
    },
  });
}
