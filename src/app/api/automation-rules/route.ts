import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  AutomationRuleInputError,
  listAutomationRules,
  setAutomationRuleEnabled,
} from "@/server/repos/rules";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID = { error: "Choose a built-in automation rule." };

async function readToggle(
  request: Request,
): Promise<{ slug: string; enabled: boolean } | null> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return null;
  }
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return null;
    }
    const record = body as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "slug" && key !== "enabled")) {
      return null;
    }
    if (typeof record.slug !== "string" || typeof record.enabled !== "boolean") {
      return null;
    }
    return { slug: record.slug, enabled: record.enabled };
  } catch {
    return null;
  }
}

export async function GET() {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  return NextResponse.json({
    rules: listAutomationRules(getDatabase(), tenant),
  });
}

export async function PATCH(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const input = await readToggle(request);
  if (!input) {
    return NextResponse.json(INVALID, { status: 400 });
  }

  try {
    const saved = setAutomationRuleEnabled(
      getDatabase(),
      tenant,
      input.slug,
      input.enabled,
    );
    if (!saved) {
      return NextResponse.json(INVALID, { status: 404 });
    }
    return NextResponse.json({ rule: saved });
  } catch (error) {
    if (error instanceof AutomationRuleInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
