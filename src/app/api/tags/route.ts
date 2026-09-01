import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { isTagEntityType } from "@/domain/tag";
import {
  taggedLabelResponse,
  tagResponse,
  readAttachTagInput,
} from "@/server/repos/tag-http";
import {
  TagInputError,
  attachTag,
  listEntityTags,
  listTags,
} from "@/server/repos/tags";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID_TAG = { error: "Enter a tag label and choose a record." };
const ENTITY_NOT_FOUND = { error: "Record not found" };

export async function GET(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const entityType = params.get("entityType");
  const entityId = params.get("entityId");
  const database = getDatabase();

  if (entityType && entityId) {
    if (!isTagEntityType(entityType)) {
      return NextResponse.json(INVALID_TAG, { status: 400 });
    }
    return NextResponse.json(
      listEntityTags(database, tenant, entityType, entityId).map(
        taggedLabelResponse,
      ),
    );
  }

  return NextResponse.json(listTags(database, tenant).map(tagResponse));
}

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const input = await readAttachTagInput(request);
  if (!input) {
    return NextResponse.json(INVALID_TAG, { status: 400 });
  }

  try {
    const attached = attachTag(getDatabase(), tenant, input);
    return attached
      ? NextResponse.json(taggedLabelResponse(attached), { status: 201 })
      : NextResponse.json(ENTITY_NOT_FOUND, { status: 404 });
  } catch (error) {
    if (error instanceof TagInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
