import { NextResponse } from "next/server";

import { NetworkingStatusTransitionError } from "@/domain/contact";
import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  contactResponse,
  readUpdateContactInput,
} from "@/server/repos/contact-http";
import {
  ContactInputError,
  deleteContact,
  getContact,
  updateContact,
} from "@/server/repos/contacts";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const CONTACT_NOT_FOUND = { error: "Contact not found" };
const INVALID_CONTACT = { error: "Enter valid contact details." };
const CONTACT_HAS_HISTORY = {
  error:
    "This contact has linked history and cannot be deleted. Set its networking status to Inactive to keep the history out of active work.",
};

function isForeignKeyConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "SQLITE_CONSTRAINT_FOREIGNKEY"
  );
}

export async function GET(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const { id } = await context.params;
  const found = getContact(getDatabase(), tenant, id);
  return found
    ? NextResponse.json(contactResponse(found))
    : NextResponse.json(CONTACT_NOT_FOUND, { status: 404 });
}

async function writeContact(request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const input = await readUpdateContactInput(request);
  if (!input) {
    return NextResponse.json(INVALID_CONTACT, { status: 400 });
  }
  try {
    const { id } = await context.params;
    const updated = updateContact(getDatabase(), tenant, id, input);
    return updated
      ? NextResponse.json(contactResponse(updated))
      : NextResponse.json(CONTACT_NOT_FOUND, { status: 404 });
  } catch (error) {
    if (
      error instanceof ContactInputError ||
      error instanceof NetworkingStatusTransitionError
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export const PATCH = writeContact;
export const PUT = writeContact;

export async function DELETE(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const { id } = await context.params;
  try {
    return deleteContact(getDatabase(), tenant, id)
      ? new Response(null, { status: 204 })
      : NextResponse.json(CONTACT_NOT_FOUND, { status: 404 });
  } catch (error) {
    if (isForeignKeyConstraint(error)) {
      return NextResponse.json(CONTACT_HAS_HISTORY, { status: 409 });
    }
    throw error;
  }
}
