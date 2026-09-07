import { ACCOUNT_PASSWORD, BASE_URL } from "../shared";

// Re-exported so this suite's own imports keep reading from one fixture, while
// the journey suite shares the same server and password (see ../shared.ts).
export { ACCOUNT_PASSWORD, BASE_URL };

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
