import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  createEmailTemplate,
  EmailContentInputError,
  ensureEmailTemplateShells,
  listEmailTemplates,
  type CreateEmailTemplateInput,
} from "@/server/repos/email-content";

export const runtime = "nodejs";

const ALLOWED_KEYS = new Set([
  "title",
  "subject",
  "body",
  "variables",
  "defaultEmailAccountId",
  "defaultDocumentVersionId",
  "defaultFollowUpDays",
  "tags",
]);

function isNullableString(value: unknown) {
  return value === undefined || value === null || typeof value === "string";
}

async function readInput(request: Request): Promise<CreateEmailTemplateInput | null> {
  try {
    const value: unknown = await request.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const input = value as Record<string, unknown>;
    if (
      Object.keys(input).some((key) => !ALLOWED_KEYS.has(key)) ||
      typeof input.title !== "string" ||
      (input.subject !== undefined && typeof input.subject !== "string") ||
      (input.body !== undefined && typeof input.body !== "string") ||
      !isNullableString(input.defaultEmailAccountId) ||
      !isNullableString(input.defaultDocumentVersionId) ||
      (input.defaultFollowUpDays !== undefined &&
        input.defaultFollowUpDays !== null &&
        typeof input.defaultFollowUpDays !== "number") ||
      (input.variables !== undefined &&
        (!Array.isArray(input.variables) ||
          input.variables.some((item) => typeof item !== "string"))) ||
      (input.tags !== undefined &&
        (!Array.isArray(input.tags) || input.tags.some((item) => typeof item !== "string")))
    ) return null;
    return input as CreateEmailTemplateInput;
  } catch {
    return null;
  }
}

export async function GET() {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const database = getDatabase();
  ensureEmailTemplateShells(database, tenant);
  return NextResponse.json({ templates: listEmailTemplates(database, tenant) });
}

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const input = await readInput(request);
  if (!input) {
    return NextResponse.json({ error: "Choose valid template fields." }, { status: 400 });
  }
  try {
    return NextResponse.json(
      createEmailTemplate(getDatabase(), tenant, input),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof EmailContentInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
