import { NextResponse } from "next/server";

import { DuplicateConflictError } from "@/domain/duplicate";

export function duplicateConflictResponse(error: DuplicateConflictError) {
  return NextResponse.json(
    { error: error.message, candidates: error.candidates },
    { status: 409 },
  );
}
