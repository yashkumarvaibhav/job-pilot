export const BASE_URL = "http://127.0.0.1:3061";
export const ACCOUNT_PASSWORD = "synthetic-responsive-password";

export const FIXTURE = {
  accountA: {
    userId: "responsive-user-a",
    workspaceId: "responsive-workspace-a",
    username: "responsive_a",
  },
  accountB: {
    userId: "responsive-user-b",
    workspaceId: "responsive-workspace-b",
    username: "responsive_b",
  },
  accountEmpty: {
    userId: "responsive-user-empty",
    workspaceId: "responsive-workspace-empty",
    username: "responsive_empty",
  },
  accountSetup: {
    userId: "responsive-user-setup",
    workspaceId: "responsive-workspace-setup",
    username: "responsive_setup",
  },
  a: {
    companyId: "responsive-company-a",
    contactId: "responsive-contact-a",
    opportunityId: "responsive-opportunity-a",
    referralId: "responsive-referral-a",
    documentId: "responsive-document-a",
    versionId: "responsive-version-a",
  },
  b: {
    companyId: "responsive-company-b",
    contactId: "responsive-contact-b",
    opportunityId: "responsive-opportunity-b",
    referralId: "responsive-referral-b",
    documentId: "responsive-document-b",
    versionId: "responsive-version-b",
  },
} as const;
