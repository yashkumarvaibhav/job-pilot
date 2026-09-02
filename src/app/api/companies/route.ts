import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { DuplicateConflictError } from "@/domain/duplicate";
import {
  CompanyInputError,
  createCompany,
  listCompanies,
} from "@/server/repos/companies";
import {
  companyResponse,
  readCreateCompanyInput,
} from "@/server/repos/company-http";
import { duplicateConflictResponse } from "@/server/repos/duplicate-http";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID_COMPANY = { error: "Enter valid company details." };

export async function GET() {
  const tenant = await currentTenant();

  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  return NextResponse.json(
    listCompanies(getDatabase(), tenant).map(companyResponse),
  );
}

export async function POST(request: Request) {
  const tenant = await currentTenant();

  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const input = await readCreateCompanyInput(request);
  if (!input) {
    return NextResponse.json(INVALID_COMPANY, { status: 400 });
  }

  try {
    const created = createCompany(getDatabase(), tenant, input);
    return NextResponse.json(companyResponse(created), { status: 201 });
  } catch (error) {
    if (error instanceof CompanyInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof DuplicateConflictError) {
      return duplicateConflictResponse(error);
    }
    throw error;
  }
}
