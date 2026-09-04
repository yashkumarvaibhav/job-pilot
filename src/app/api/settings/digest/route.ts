import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  digestPolicyResponse,
  readDigestInput,
} from "@/server/repos/digest-http";
import {
  DigestInputError,
  readDigestPolicy,
  updateDigestPolicy,
} from "@/server/repos/digest";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID = {
  error:
    "Digest settings accept an hour, one Gmail account and the email-my-digest switch.",
};

export async function GET() {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  return NextResponse.json(
    digestPolicyResponse(readDigestPolicy(getDatabase(), tenant)),
  );
}

export async function PATCH(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const input = await readDigestInput(request);
  if (!input) {
    return NextResponse.json(INVALID, { status: 400 });
  }
  try {
    const saved = updateDigestPolicy(getDatabase(), tenant, input);
    return NextResponse.json(digestPolicyResponse(saved));
  } catch (error) {
    if (error instanceof DigestInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
