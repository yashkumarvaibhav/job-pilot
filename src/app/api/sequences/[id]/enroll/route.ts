import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  enrollmentJson,
  jsonObject,
  readEnrollInput,
  sequenceErrorStatus,
} from "@/server/repos/sequence-http";
import { SequenceError, enrollSequence } from "@/server/repos/sequences";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
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
  const parsed = jsonObject(raw);
  const input = parsed ? readEnrollInput(parsed) : null;
  if (!input) {
    return NextResponse.json(
      { error: "Choose one contact and one sending account." },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(
      enrollmentJson(
        enrollSequence(getDatabase(), tenant, {
          sequenceId: (await context.params).id,
          contactId: input.contactId,
          accountId: input.accountId,
          opportunityId: input.opportunityId,
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
