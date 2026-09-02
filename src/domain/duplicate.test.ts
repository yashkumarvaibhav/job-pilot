import { describe, expect, it } from "vitest";

import {
  DUPLICATE_JOB_WARNING,
  DUPLICATE_COMPANY_WARNING,
  canonicalHttpUrl,
  matchCompanySignals,
  matchOpportunitySignals,
  parseDuplicateConflict,
  duplicateSignalLabel,
} from "./duplicate";

describe("duplicate signals", () => {
  it("warns on the same company name regardless of surrounding case or space", () => {
    expect(
      matchCompanySignals(
        { name: " Microsoft ", website: null, careersUrl: null },
        { name: "microsoft", website: null, careersUrl: null },
      ),
    ).toEqual(["same_name"]);
  });

  it("warns when any company URL matches the other row's website or careers URL", () => {
    expect(
      matchCompanySignals(
        {
          name: "Other",
          website: "https://WWW.Careers.Invalid.Test/jobs/",
          careersUrl: null,
        },
        {
          name: "Acme",
          website: null,
          careersUrl: "https://careers.invalid.test/jobs",
        },
      ),
    ).toEqual(["same_url"]);
  });

  it("does not treat blank names or blank URLs as a match", () => {
    expect(
      matchCompanySignals(
        { name: "Acme", website: "", careersUrl: "   " },
        { name: "Other", website: null, careersUrl: "" },
      ),
    ).toEqual([]);
  });

  it("always warns on the same job ID at the same company", () => {
    expect(
      matchOpportunitySignals(
        {
          companyId: "microsoft",
          role: "SRE",
          jobId: " 182763 ",
          url: null,
          location: "Hyderabad",
          postedOn: null,
          deadlineOn: null,
        },
        {
          companyId: "microsoft",
          role: "SDE",
          jobId: "182763",
          url: null,
          location: "Bengaluru",
          postedOn: "2026-01-01",
          deadlineOn: "2026-02-01",
        },
      ),
    ).toEqual(["same_company_job_id"]);
  });

  it("warns on the same job URL after canonicalising host, slash and hash", () => {
    expect(
      matchOpportunitySignals(
        {
          companyId: "google",
          role: "SDE II",
          jobId: null,
          url: "https://WWW.Careers.Google.Invalid.Test/jobs/99#apply",
          location: null,
          postedOn: null,
          deadlineOn: null,
        },
        {
          companyId: "other",
          role: "Intern",
          jobId: "x",
          url: "https://careers.google.invalid.test/jobs/99/",
          location: null,
          postedOn: null,
          deadlineOn: null,
        },
      ),
    ).toEqual(["same_url"]);
  });

  it("warns on the same company, role, location and close dates", () => {
    expect(
      matchOpportunitySignals(
        {
          companyId: "microsoft",
          role: " SDE ",
          jobId: "new-id",
          url: "https://other.invalid.test/a",
          location: "Bengaluru",
          postedOn: "2026-08-01",
          deadlineOn: "2026-09-15",
        },
        {
          companyId: "microsoft",
          role: "sde",
          jobId: "old-id",
          url: "https://other.invalid.test/b",
          location: " bengaluru ",
          postedOn: "2026-08-01",
          deadlineOn: "2026-09-15",
        },
      ),
    ).toEqual(["same_company_role_location_dates"]);
  });

  it("does not fire the close-date signal when location or both dates are missing", () => {
    expect(
      matchOpportunitySignals(
        {
          companyId: "microsoft",
          role: "SDE",
          jobId: "a",
          url: null,
          location: "",
          postedOn: "2026-08-01",
          deadlineOn: "2026-09-15",
        },
        {
          companyId: "microsoft",
          role: "SDE",
          jobId: "b",
          url: null,
          location: "",
          postedOn: "2026-08-01",
          deadlineOn: "2026-09-15",
        },
      ),
    ).toEqual([]);
    expect(
      matchOpportunitySignals(
        {
          companyId: "microsoft",
          role: "SDE",
          jobId: "a",
          url: null,
          location: "Bengaluru",
          postedOn: null,
          deadlineOn: null,
        },
        {
          companyId: "microsoft",
          role: "SDE",
          jobId: "b",
          url: null,
          location: "Bengaluru",
          postedOn: null,
          deadlineOn: null,
        },
      ),
    ).toEqual([]);
  });

  it("does not treat a neighbouring deadline as the same close date", () => {
    expect(
      matchOpportunitySignals(
        {
          companyId: "microsoft",
          role: "SDE",
          jobId: "a",
          url: null,
          location: "Bengaluru",
          postedOn: "2026-08-01",
          deadlineOn: "2026-09-16",
        },
        {
          companyId: "microsoft",
          role: "SDE",
          jobId: "b",
          url: null,
          location: "Bengaluru",
          postedOn: "2026-08-01",
          deadlineOn: "2026-09-15",
        },
      ),
    ).toEqual([]);
  });

  it("collects every matching signal on one candidate", () => {
    expect(
      matchOpportunitySignals(
        {
          companyId: "microsoft",
          role: "SDE",
          jobId: "182763",
          url: "https://jobs.invalid.test/182763",
          location: "Bengaluru",
          postedOn: "2026-08-01",
          deadlineOn: "2026-09-15",
        },
        {
          companyId: "microsoft",
          role: "SDE",
          jobId: "182763",
          url: "https://jobs.invalid.test/182763",
          location: "Bengaluru",
          postedOn: "2026-08-01",
          deadlineOn: "2026-09-15",
        },
      ),
    ).toEqual([
      "same_url",
      "same_company_job_id",
      "same_company_role_location_dates",
    ]);
  });

  it("exposes the owner-facing warning sentences and signal labels", () => {
    expect(DUPLICATE_JOB_WARNING).toBe("This job may already be tracked.");
    expect(DUPLICATE_COMPANY_WARNING).toBe(
      "This company may already be tracked.",
    );
    expect(duplicateSignalLabel("same_company_job_id")).toBe(
      "same company and job ID",
    );
  });

  it("canonicalises http(s) URLs and rejects anything else", () => {
    expect(canonicalHttpUrl("https://WWW.Example.Invalid.Test/jobs/#x")).toBe(
      "https://example.invalid.test/jobs",
    );
    expect(canonicalHttpUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalHttpUrl("")).toBeNull();
  });

  it("parses a 409 body and ignores any other status", () => {
    const body = {
      error: DUPLICATE_JOB_WARNING,
      candidates: [
        {
          id: "ms-sde",
          entityType: "opportunity",
          label: "Microsoft · SDE",
          href: "/opportunities/ms-sde",
          signals: ["same_company_job_id"],
        },
      ],
    };
    expect(parseDuplicateConflict(409, body)).toEqual(body);
    expect(parseDuplicateConflict(400, body)).toBeNull();
    expect(parseDuplicateConflict(409, { error: "nope" })).toBeNull();
  });
});
