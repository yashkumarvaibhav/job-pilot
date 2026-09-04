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
  createSequence,
  listSequences,
} from "@/server/repos/sequences";

export const runtime = "nodejs";

export async function GET() {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  return NextResponse.json({
    sequences: listSequences(getDatabase(), tenant).map(sequenceJson),
  });
}

export async function POST(request: Request) {
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
  if (!parsed || parsed.name === undefined || parsed.steps === undefined) {
    return NextResponse.json(
      { error: "Choose a sequence name and at least one step." },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(
      sequenceJson(
        createSequence(getDatabase(), tenant, {
          name: parsed.name,
          steps: parsed.steps,
        }),
      ),
      { status: 201 },
    );
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
