import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  CompanyInputError,
  deleteCompany,
  getCompany,
  updateCompany,
} from "@/server/repos/companies";
import {
  companyResponse,
  readUpdateCompanyInput,
} from "@/server/repos/company-http";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const COMPANY_NOT_FOUND = { error: "Company not found" };
const INVALID_COMPANY = { error: "Enter valid company details." };

export async function GET(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();

  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const { id } = await context.params;
  const found = getCompany(getDatabase(), tenant, id);

  return found
    ? NextResponse.json(companyResponse(found))
    : NextResponse.json(COMPANY_NOT_FOUND, { status: 404 });
}

async function writeCompany(request: Request, context: RouteContext) {
  const tenant = await currentTenant();

  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const input = await readUpdateCompanyInput(request);
  if (!input) {
    return NextResponse.json(INVALID_COMPANY, { status: 400 });
  }

  try {
    const { id } = await context.params;
    const updated = updateCompany(getDatabase(), tenant, id, input);
    return updated
      ? NextResponse.json(companyResponse(updated))
      : NextResponse.json(COMPANY_NOT_FOUND, { status: 404 });
  } catch (error) {
    if (error instanceof CompanyInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export const PATCH = writeCompany;
export const PUT = writeCompany;

export async function DELETE(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();

  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const { id } = await context.params;
  return deleteCompany(getDatabase(), tenant, id)
    ? new Response(null, { status: 204 })
    : NextResponse.json(COMPANY_NOT_FOUND, { status: 404 });
}
