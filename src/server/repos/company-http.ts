import type {
  Company,
  CreateCompanyInput,
  UpdateCompanyInput,
} from "./companies";

const TEXT_FIELDS = [
  "website",
  "careersUrl",
  "industry",
  "type",
  "locations",
  "notes",
  "nextAction",
  "nextActionDue",
] as const;
const ALLOWED_FIELDS = new Set<string>(["name", "target", "tags", ...TEXT_FIELDS]);
const ALLOWED_CREATE_FIELDS = new Set<string>([
  ...ALLOWED_FIELDS,
  "acknowledgeDuplicates",
]);

async function readObject(request: Request): Promise<Record<string, unknown> | null> {
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

function hasOnlyCompanyFields(
  body: Record<string, unknown>,
  allowed: Set<string> = ALLOWED_FIELDS,
): boolean {
  return Object.keys(body).every((key) => allowed.has(key));
}

function hasValidOptionalFields(body: Record<string, unknown>): boolean {
  if ("target" in body && typeof body.target !== "boolean") {
    return false;
  }
  if (
    "tags" in body &&
    (!Array.isArray(body.tags) ||
      !body.tags.every((tag) => typeof tag === "string"))
  ) {
    return false;
  }
  if (
    "acknowledgeDuplicates" in body &&
    typeof body.acknowledgeDuplicates !== "boolean"
  ) {
    return false;
  }

  return TEXT_FIELDS.every(
    (field) =>
      !(field in body) ||
      typeof body[field] === "string" ||
      body[field] === null,
  );
}

export async function readCreateCompanyInput(
  request: Request,
): Promise<CreateCompanyInput | null> {
  const body = await readObject(request);

  if (
    !body ||
    !hasOnlyCompanyFields(body, ALLOWED_CREATE_FIELDS) ||
    !hasValidOptionalFields(body) ||
    typeof body.name !== "string"
  ) {
    return null;
  }

  return body as CreateCompanyInput;
}

export async function readUpdateCompanyInput(
  request: Request,
): Promise<UpdateCompanyInput | null> {
  const body = await readObject(request);

  if (
    !body ||
    !hasOnlyCompanyFields(body) ||
    !hasValidOptionalFields(body) ||
    ("name" in body && typeof body.name !== "string")
  ) {
    return null;
  }

  return body as UpdateCompanyInput;
}

export function companyResponse(company: Company) {
  return {
    id: company.id,
    name: company.name,
    website: company.website,
    careersUrl: company.careersUrl,
    industry: company.industry,
    type: company.type,
    locations: company.locations,
    target: company.target,
    notes: company.notes,
    nextAction: company.nextAction,
    nextActionDue: company.nextActionDue,
    createdAt: company.createdAt.toISOString(),
  };
}
