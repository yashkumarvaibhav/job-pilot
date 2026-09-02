import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  contactListResponse,
  contactResponse,
  readCreateContactInput,
} from "@/server/repos/contact-http";
import {
  ContactInputError,
  createContact,
  listContacts,
  parseContactListFilter,
} from "@/server/repos/contacts";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID_CONTACT = { error: "Enter valid contact details." };

export async function GET(request?: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const search = request
    ? new URL(request.url).searchParams
    : new URLSearchParams();
  return NextResponse.json(
    listContacts(
      getDatabase(),
      tenant,
      parseContactListFilter(search),
    ).map(contactListResponse),
  );
}

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const input = await readCreateContactInput(request);
  if (!input) {
    return NextResponse.json(INVALID_CONTACT, { status: 400 });
  }
  try {
    return NextResponse.json(
      contactResponse(createContact(getDatabase(), tenant, input)),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ContactInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
