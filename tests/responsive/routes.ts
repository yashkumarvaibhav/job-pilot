import { FIXTURE } from "./fixture";

export type RegisteredPage = {
  file: string;
  path: string;
  access: "signed-in" | "signed-out" | "setup";
};

export const REGISTERED_PAGES: RegisteredPage[] = [
  { file: "(auth)/login/page.tsx", path: "/login", access: "signed-out" },
  { file: "(auth)/signup/page.tsx", path: "/signup", access: "signed-out" },
  { file: "(auth)/setup-totp/page.tsx", path: "/setup-totp", access: "setup" },
  { file: "(auth)/forgot-password/page.tsx", path: "/forgot-password", access: "signed-out" },
  { file: "(app)/(today)/page.tsx", path: "/", access: "signed-in" },
  { file: "(app)/add/page.tsx", path: "/add", access: "signed-in" },
  { file: "(app)/analytics/page.tsx", path: "/analytics", access: "signed-in" },
  { file: "(app)/applications/page.tsx", path: "/applications", access: "signed-in" },
  { file: "(app)/companies/page.tsx", path: "/companies", access: "signed-in" },
  { file: "(app)/companies/[id]/page.tsx", path: `/companies/${FIXTURE.a.companyId}`, access: "signed-in" },
  { file: "(app)/compose/page.tsx", path: `/compose?contactId=${FIXTURE.a.contactId}&opportunityId=${FIXTURE.a.opportunityId}`, access: "signed-in" },
  { file: "(app)/contacts/page.tsx", path: "/contacts", access: "signed-in" },
  { file: "(app)/contacts/[id]/page.tsx", path: `/contacts/${FIXTURE.a.contactId}`, access: "signed-in" },
  { file: "(app)/inbox/page.tsx", path: "/inbox", access: "signed-in" },
  { file: "(app)/more/page.tsx", path: "/more", access: "signed-in" },
  { file: "(app)/notifications/page.tsx", path: "/notifications", access: "signed-in" },
  { file: "(app)/opportunities/page.tsx", path: "/opportunities", access: "signed-in" },
  { file: "(app)/opportunities/[id]/page.tsx", path: `/opportunities/${FIXTURE.a.opportunityId}`, access: "signed-in" },
  { file: "(app)/referrals/page.tsx", path: "/referrals", access: "signed-in" },
  { file: "(app)/referrals/[id]/page.tsx", path: `/referrals/${FIXTURE.a.referralId}`, access: "signed-in" },
  { file: "(app)/settings/page.tsx", path: "/settings", access: "signed-in" },
  { file: "(app)/settings/activity/page.tsx", path: "/settings/activity", access: "signed-in" },
  { file: "(app)/settings/documents/page.tsx", path: "/settings/documents", access: "signed-in" },
  { file: "(app)/settings/import/page.tsx", path: "/settings/import", access: "signed-in" },
  { file: "(app)/settings/queue/page.tsx", path: "/settings/queue", access: "signed-in" },
  { file: "(app)/settings/templates/page.tsx", path: "/settings/templates", access: "signed-in" },
  { file: "(app)/tasks/page.tsx", path: "/tasks", access: "signed-in" },
];
