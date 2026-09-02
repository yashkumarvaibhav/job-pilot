import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { DuplicateConflictError } from "@/domain/duplicate";
import {
  OpportunityInputError,
  createOpportunityFromConversation,
} from "@/server/repos/opportunities";
import {
  opportunityResponse,
  readFromConversationInput,
} from "@/server/repos/opportunity-http";
import { duplicateConflictResponse } from "@/server/repos/duplicate-http";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const NOT_FOUND = { error: "Contact not found" };
const INVALID_OPPORTUNITY = { error: "Enter valid opportunity details." };

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const input = await readFromConversationInput(request);
  if (!input) {
    return NextResponse.json(INVALID_OPPORTUNITY, { status: 400 });
  }

  try {
    const created = createOpportunityFromConversation(
      getDatabase(),
      tenant,
      input,
    );
    return created
      ? NextResponse.json(opportunityResponse(created), { status: 201 })
      : NextResponse.json(NOT_FOUND, { status: 404 });
  } catch (error) {
    if (error instanceof OpportunityInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof DuplicateConflictError) {
      return duplicateConflictResponse(error);
    }
    throw error;
  }
}
