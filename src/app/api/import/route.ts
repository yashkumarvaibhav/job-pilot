import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  ImportInputError,
  planImport,
  readImportBody,
} from "@/server/imports/import-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "Enter valid import details." }, { status: 400 });
  }

  try {
    const body: unknown = await request.json();
    return NextResponse.json(planImport(getDatabase(), tenant, readImportBody(body)));
  } catch (error) {
    if (error instanceof ImportInputError || error instanceof SyntaxError) {
      return NextResponse.json(
        { error: error instanceof ImportInputError ? error.message : "Enter valid import details." },
        { status: 400 },
      );
    }
    throw error;
  }
}
