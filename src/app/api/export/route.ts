import { NextResponse } from "next/server";

import { ExportInputError } from "@/domain/export";
import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { exportFromSearchParams } from "@/server/repos/export";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };

export async function GET(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  try {
    const file = exportFromSearchParams(
      getDatabase(),
      tenant,
      new URL(request.url).searchParams,
    );
    return new NextResponse(file.body, {
      status: 200,
      headers: {
        "content-type": file.contentType,
        "content-disposition": `attachment; filename="${file.filename}"`,
        "cache-control": "no-store, private",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ExportInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
