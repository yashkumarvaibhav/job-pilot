import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  readUploadInput,
  versionResponse,
} from "@/server/repos/document-http";
import {
  DocumentInputError,
  getDocument,
  storeDocumentVersion,
} from "@/server/repos/documents";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const NOT_FOUND = { error: "Document not found" };
const INVALID = { error: "Choose a file and a version label." };

export async function POST(request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const { id } = await context.params;
  const owner = getDocument(getDatabase(), tenant, id);
  if (!owner) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }
  const input = await readUploadInput(request);
  if (!input) {
    return NextResponse.json(INVALID, { status: 400 });
  }
  try {
    const version = storeDocumentVersion(getDatabase(), tenant, {
      documentId: owner.id,
      label: input.label,
      bytes: input.bytes,
      contentType: input.contentType,
      originalFilename: input.originalFilename,
    });
    return NextResponse.json(versionResponse(version, owner.name), {
      status: 201,
    });
  } catch (error) {
    if (error instanceof DocumentInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
