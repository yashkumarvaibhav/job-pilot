import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import {
  currentIncompleteSignupTenant,
  endSession,
} from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { userAccount } from "@/server/db/schema";

export const runtime = "nodejs";

const INCOMPLETE_SIGNUP_REQUIRED = "Incomplete signup required.";

export async function POST() {
  const tenant = await currentIncompleteSignupTenant();
  if (!tenant) {
    return NextResponse.json(
      { error: INCOMPLETE_SIGNUP_REQUIRED },
      { status: 401 },
    );
  }

  const deleted = getDatabase().transaction((transaction) =>
    transaction
      .delete(userAccount)
      .where(
        and(
          eq(userAccount.id, tenant.userId),
          isNull(userAccount.signupCompletedAt),
        ),
      )
      .run().changes,
  );

  if (deleted !== 1) {
    return NextResponse.json(
      { error: INCOMPLETE_SIGNUP_REQUIRED },
      { status: 409 },
    );
  }

  await endSession();
  return NextResponse.json({ ok: true, redirect: "/" });
}
