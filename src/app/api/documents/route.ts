import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  documentResponse,
  readCreateDocumentInput,
} from "@/server/repos/document-http";
import {
  DocumentInputError,
  createDocument,
  listDocuments,
} from "@/server/repos/documents";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID = { error: "A document needs a name and a known type." };

export async function GET() {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  return NextResponse.json({
    documents: listDocuments(getDatabase(), tenant).map(documentResponse),
  });
}

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const input = await readCreateDocumentInput(request);
  if (!input) {
    return NextResponse.json(INVALID, { status: 400 });
  }
  try {
    const created = createDocument(getDatabase(), tenant, input);
    return NextResponse.json(
      documentResponse({ ...created, versions: [] }),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof DocumentInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
