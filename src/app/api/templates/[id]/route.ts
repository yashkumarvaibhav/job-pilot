import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  deleteEmailTemplate,
  EmailContentInputError,
  updateEmailTemplate,
  type UpdateEmailTemplateInput,
} from "@/server/repos/email-content";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

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

async function readInput(request: Request): Promise<UpdateEmailTemplateInput | null> {
  try {
    const value: unknown = await request.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const input = value as Record<string, unknown>;
    const keys = Object.keys(input);
    if (
      keys.length === 0 ||
      keys.some((key) => !ALLOWED_KEYS.has(key)) ||
      (input.title !== undefined && typeof input.title !== "string") ||
      (input.subject !== undefined && typeof input.subject !== "string") ||
      (input.body !== undefined && typeof input.body !== "string") ||
      (input.defaultEmailAccountId !== undefined &&
        input.defaultEmailAccountId !== null &&
        typeof input.defaultEmailAccountId !== "string") ||
      (input.defaultDocumentVersionId !== undefined &&
        input.defaultDocumentVersionId !== null &&
        typeof input.defaultDocumentVersionId !== "string") ||
      (input.defaultFollowUpDays !== undefined &&
        input.defaultFollowUpDays !== null &&
        typeof input.defaultFollowUpDays !== "number") ||
      (input.variables !== undefined &&
        (!Array.isArray(input.variables) ||
          input.variables.some((item) => typeof item !== "string"))) ||
      (input.tags !== undefined &&
        (!Array.isArray(input.tags) || input.tags.some((item) => typeof item !== "string")))
    ) return null;
    return input as UpdateEmailTemplateInput;
  } catch {
    return null;
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const input = await readInput(request);
  if (!input) {
    return NextResponse.json({ error: "Choose valid template fields." }, { status: 400 });
  }
  const { id } = await context.params;
  try {
    const updated = updateEmailTemplate(getDatabase(), tenant, id, input);
    return updated
      ? NextResponse.json(updated)
      : NextResponse.json({ error: "Template not found." }, { status: 404 });
  } catch (error) {
    if (error instanceof EmailContentInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const { id } = await context.params;
  return deleteEmailTemplate(getDatabase(), tenant, id)
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Template not found." }, { status: 404 });
}
