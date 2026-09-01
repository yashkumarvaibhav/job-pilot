import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { getContact } from "@/server/repos/contacts";
import {
  interactionResponse,
  readCreateInteractionInput,
} from "@/server/repos/interaction-http";
import {
  InteractionInputError,
  createInteraction,
} from "@/server/repos/interactions";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const CONTACT_NOT_FOUND = { error: "Contact not found" };
const INVALID_INTERACTION = { error: "Enter a valid interaction." };

export async function POST(request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const { id } = await context.params;
  if (!getContact(getDatabase(), tenant, id)) {
    return NextResponse.json(CONTACT_NOT_FOUND, { status: 404 });
  }

  const input = await readCreateInteractionInput(request);
  if (!input) {
    return NextResponse.json(INVALID_INTERACTION, { status: 400 });
  }

  try {
    const created = createInteraction(getDatabase(), tenant, {
      ...input,
      contactId: id,
    });
    return NextResponse.json(interactionResponse(created), { status: 201 });
  } catch (error) {
    if (error instanceof InteractionInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
