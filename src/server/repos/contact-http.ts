import {
  isContactMethodKind,
  isContactRelationship,
  isNetworkingStatus,
} from "../../domain/contact";
import type {
  ContactDetail,
  ContactListItem,
  ContactMethodInput,
  CreateContactInput,
  UpdateContactInput,
} from "./contacts";

const TEXT_FIELDS = [
  "companyId",
  "designation",
  "source",
  "location",
  "notes",
  "nextAction",
  "followUpOn",
] as const;
const CREATE_FIELDS = new Set<string>([
  "name",
  "relationship",
  "tags",
  "preferredContactChannel",
  "networkingStatus",
  "lastInteractionAt",
  "methods",
  ...TEXT_FIELDS,
]);
const UPDATE_FIELDS = new Set<string>([
  ...CREATE_FIELDS,
  "overrideDoNotContact",
]);

async function readObject(
  request: Request,
): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return null;
  }
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function hasOnlyFields(body: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(body).every((key) => allowed.has(key));
}

function hasValidTextFields(body: Record<string, unknown>) {
  return TEXT_FIELDS.every(
    (field) =>
      !(field in body) ||
      typeof body[field] === "string" ||
      body[field] === null,
  );
}

function validMethods(value: unknown): value is ContactMethodInput[] {
  return (
    Array.isArray(value) &&
    value.every(
      (method) =>
        typeof method === "object" &&
        method !== null &&
        !Array.isArray(method) &&
        Object.keys(method).every((key) =>
          ["kind", "value", "isPrimary"].includes(key),
        ) &&
        "kind" in method &&
        isContactMethodKind(method.kind) &&
        "value" in method &&
        typeof method.value === "string" &&
        (!("isPrimary" in method) || typeof method.isPrimary === "boolean"),
    )
  );
}

function validCommonFields(body: Record<string, unknown>): boolean {
  return (
    hasValidTextFields(body) &&
    (!("name" in body) || typeof body.name === "string") &&
    (!("relationship" in body) || isContactRelationship(body.relationship)) &&
    (!("networkingStatus" in body) ||
      isNetworkingStatus(body.networkingStatus)) &&
    (!("preferredContactChannel" in body) ||
      body.preferredContactChannel === null ||
      isContactMethodKind(body.preferredContactChannel)) &&
    (!("tags" in body) ||
      (Array.isArray(body.tags) &&
        body.tags.every((tag) => typeof tag === "string"))) &&
    (!("methods" in body) || validMethods(body.methods)) &&
    (!("lastInteractionAt" in body) ||
      body.lastInteractionAt === null ||
      typeof body.lastInteractionAt === "string")
  );
}

function parsedInstant(value: unknown): Date | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  const parsed = new Date(value as string);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
}

function inputFrom(body: Record<string, unknown>) {
  return {
    ...body,
    ...(body.lastInteractionAt !== undefined
      ? { lastInteractionAt: parsedInstant(body.lastInteractionAt) }
      : {}),
  };
}

export async function readCreateContactInput(
  request: Request,
): Promise<CreateContactInput | null> {
  const body = await readObject(request);
  if (
    !body ||
    !hasOnlyFields(body, CREATE_FIELDS) ||
    !validCommonFields(body) ||
    typeof body.name !== "string" ||
    ("lastInteractionAt" in body &&
      parsedInstant(body.lastInteractionAt) === undefined)
  ) {
    return null;
  }
  return inputFrom(body) as CreateContactInput;
}

export async function readUpdateContactInput(
  request: Request,
): Promise<UpdateContactInput | null> {
  const body = await readObject(request);
  if (
    !body ||
    !hasOnlyFields(body, UPDATE_FIELDS) ||
    !validCommonFields(body) ||
    ("overrideDoNotContact" in body &&
      typeof body.overrideDoNotContact !== "boolean") ||
    ("lastInteractionAt" in body &&
      parsedInstant(body.lastInteractionAt) === undefined)
  ) {
    return null;
  }
  return inputFrom(body) as UpdateContactInput;
}

export function contactListResponse(contact: ContactListItem) {
  return {
    id: contact.id,
    companyId: contact.companyId,
    companyName: contact.companyName,
    name: contact.name,
    designation: contact.designation,
    relationship: contact.relationship,
    source: contact.source,
    location: contact.location,
    notes: contact.notes,
    tags: contact.tagsJson,
    preferredContactChannel: contact.preferredContactChannel,
    networkingStatus: contact.networkingStatus,
    lastInteractionAt: contact.lastInteractionAt?.toISOString() ?? null,
    nextAction: contact.nextAction,
    followUpOn: contact.followUpOn,
    createdAt: contact.createdAt.toISOString(),
  };
}

export function contactResponse(contact: ContactDetail) {
  return {
    ...contactListResponse(contact),
    methods: contact.methods.map((method) => ({
      id: method.id,
      kind: method.kind,
      value: method.value,
      isPrimary: method.isPrimary,
      createdAt: method.createdAt.toISOString(),
    })),
  };
}
