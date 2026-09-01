import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { getContact } from "@/server/repos/contacts";
import { interactionResponse } from "@/server/repos/interaction-http";
import {
  InteractionInputError,
  getInteraction,
  markInteractionReplied,
} from "@/server/repos/interactions";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string; interactionId: string }>;
};

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const CONTACT_NOT_FOUND = { error: "Contact not found" };
const INTERACTION_NOT_FOUND = { error: "Interaction not found" };

export async function POST(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const { id, interactionId } = await context.params;
  if (!getContact(getDatabase(), tenant, id)) {
    return NextResponse.json(CONTACT_NOT_FOUND, { status: 404 });
  }

  const existing = getInteraction(getDatabase(), tenant, interactionId);
  if (!existing || existing.contactId !== id) {
    return NextResponse.json(INTERACTION_NOT_FOUND, { status: 404 });
  }

  try {
    const updated = markInteractionReplied(
      getDatabase(),
      tenant,
      interactionId,
    );
    return updated
      ? NextResponse.json(interactionResponse(updated))
      : NextResponse.json(INTERACTION_NOT_FOUND, { status: 404 });
  } catch (error) {
    if (error instanceof InteractionInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
