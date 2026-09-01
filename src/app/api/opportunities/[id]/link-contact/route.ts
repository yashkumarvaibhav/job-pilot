import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { getContact } from "@/server/repos/contacts";
import {
  getOpportunity,
  linkContactToOpportunity,
} from "@/server/repos/opportunities";
import {
  linkedContactResponse,
  readLinkContactInput,
} from "@/server/repos/opportunity-http";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const OPPORTUNITY_NOT_FOUND = { error: "Opportunity not found" };
const CONTACT_NOT_FOUND = { error: "Contact not found" };
const INVALID_LINK = { error: "Choose a contact to link." };

export async function POST(request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const { id } = await context.params;
  const database = getDatabase();
  if (!getOpportunity(database, tenant, id)) {
    return NextResponse.json(OPPORTUNITY_NOT_FOUND, { status: 404 });
  }

  const input = await readLinkContactInput(request);
  if (!input) {
    return NextResponse.json(INVALID_LINK, { status: 400 });
  }
  if (!getContact(database, tenant, input.contactId)) {
    return NextResponse.json(CONTACT_NOT_FOUND, { status: 404 });
  }

  const linked = linkContactToOpportunity(
    database,
    tenant,
    id,
    input.contactId,
  );
  return linked
    ? NextResponse.json(linkedContactResponse(linked), { status: 201 })
    : NextResponse.json(OPPORTUNITY_NOT_FOUND, { status: 404 });
}
