import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  jsonObject,
  readSequenceWriteInput,
  sequenceErrorStatus,
  sequenceJson,
} from "@/server/repos/sequence-http";
import {
  SequenceError,
  getSequence,
  updateSequence,
} from "@/server/repos/sequences";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const row = getSequence(getDatabase(), tenant, (await context.params).id);
  return row
    ? NextResponse.json(sequenceJson(row))
    : NextResponse.json({ error: "Sequence not found." }, { status: 404 });
}

export async function PATCH(request: Request, context: Context) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = null;
  }
  const input = jsonObject(raw);
  const parsed = input ? readSequenceWriteInput(input) : null;
  if (!parsed) {
    return NextResponse.json(
      { error: "Choose valid sequence fields." },
      { status: 400 },
    );
  }
  try {
    const updated = updateSequence(
      getDatabase(),
      tenant,
      (await context.params).id,
      parsed,
    );
    return updated
      ? NextResponse.json(sequenceJson(updated))
      : NextResponse.json({ error: "Sequence not found." }, { status: 404 });
  } catch (error) {
    if (error instanceof SequenceError) {
      return NextResponse.json(
        { error: error.message },
        { status: sequenceErrorStatus(error) },
      );
    }
    throw error;
  }
}
