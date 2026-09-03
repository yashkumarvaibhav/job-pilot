import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  SendSafetyError,
  addSuppressionEntry,
  listSuppressionEntries,
} from "@/server/repos/send-safety";

export const runtime = "nodejs";

export async function GET() {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  return NextResponse.json(listSuppressionEntries(getDatabase(), tenant));
}

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    input = null;
  }
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => key !== "email") ||
    !("email" in input) ||
    typeof input.email !== "string"
  ) {
    return NextResponse.json({ error: "Add one valid suppression email." }, { status: 400 });
  }
  try {
    return NextResponse.json(
      addSuppressionEntry(getDatabase(), tenant, {
        email: input.email,
        reason: "manual",
      }),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SendSafetyError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
