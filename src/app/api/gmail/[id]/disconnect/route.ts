import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { revokeGoogleRefreshToken } from "@/server/mail/google-revoke";
import {
  disconnectEmailAccount,
  readEmailAccountGoogleSubject,
  readEmailAccountRefreshToken,
} from "@/server/repos/email-accounts";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }
  const { id } = await context.params;
  const database = getDatabase();
  if (!readEmailAccountGoogleSubject(database, tenant, id)) {
    return NextResponse.json({ error: "Gmail account not found." }, { status: 404 });
  }

  let googleRevoked = false;
  const tokenKey = process.env.TOKEN_KEY?.trim();
  if (tokenKey) {
    try {
      const refreshToken = readEmailAccountRefreshToken(
        database,
        tenant,
        id,
        tokenKey,
      );
      if (refreshToken) {
        googleRevoked = await revokeGoogleRefreshToken(refreshToken);
      }
    } catch {
      // Local removal must remain possible after a key or remote-service failure.
    }
  }

  if (!disconnectEmailAccount(database, tenant, id)) {
    return NextResponse.json({ error: "Gmail account not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, googleRevoked });
}
