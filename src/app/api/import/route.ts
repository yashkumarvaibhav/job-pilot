import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  ImportInputError,
  importFields,
  executeImport,
  readEntitySet,
  readImportBody,
  readMappingBody,
} from "@/server/imports/import-service";
import {
  getImportMapping,
  saveImportMapping,
} from "@/server/repos/import-mappings";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  try {
    const entitySet = readEntitySet(new URL(request.url).searchParams.get("entitySet"));
    return NextResponse.json({
      entitySet,
      fields: importFields(entitySet),
      mapping: getImportMapping(getDatabase(), tenant, entitySet),
    });
  } catch (error) {
    if (error instanceof ImportInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function PUT(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  try {
    const body: unknown = await request.json();
    const input = readMappingBody(body);
    return NextResponse.json({
      entitySet: input.entitySet,
      mapping: saveImportMapping(
        getDatabase(),
        tenant,
        input.entitySet,
        input.mapping,
      ),
    });
  } catch (error) {
    if (error instanceof ImportInputError || error instanceof SyntaxError) {
      return NextResponse.json(
        { error: error instanceof ImportInputError ? error.message : "Enter valid mapping details." },
        { status: 400 },
      );
    }
    throw error;
  }
}

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
    return NextResponse.json(executeImport(getDatabase(), tenant, readImportBody(body)));
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
