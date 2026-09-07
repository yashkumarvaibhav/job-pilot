import { expect, test } from "@playwright/test";

import {
  JOURNEY_ACCOUNTS,
  openCreateForm,
  saveAndSettle,
  signIn,
  workspaceDate,
} from "./fixture";

/**
 * The other half of an off-campus search: people. A contact is added, a real
 * conversation is logged against them, and the follow-up that conversation
 * creates has to surface on Today by itself. That last hop is the product's
 * central promise — work you record once comes back when it is due.
 */
test.describe.configure({ mode: "serial" });

const COMPANY = "Halcyon Systems";
const CONTACT = "Ananya Rao";

test.beforeEach(async ({ page }) => {
  await signIn(page, JOURNEY_ACCOUNTS.networking);
});

test("a contact can be added against a tracked company", async ({ page }) => {
  await page.goto("/companies");
  const companyForm = await openCreateForm(
    page,
    "Add company",
    "new-company-form",
    "Company name",
  );
  await companyForm.getByLabel("Company name", { exact: true }).fill(COMPANY);
  await companyForm.getByRole("button", { name: "Save company" }).click();
  await expect(page.getByRole("heading", { level: 1, name: COMPANY })).toBeVisible();

  await page.goto("/contacts");
  const form = await openCreateForm(page, "Add contact", "new-contact-form", "Name");
  await form.getByLabel("Name", { exact: true }).fill(CONTACT);
  await form.getByLabel("Company", { exact: true }).fill(COMPANY);
  await form.getByLabel("Designation", { exact: true }).fill("Senior Engineer");
  await form.getByLabel("Relationship", { exact: true }).selectOption("alumni");
  await form
    .getByLabel("Networking status", { exact: true })
    .selectOption("ready_to_contact");
  await form.getByRole("button", { name: "Save contact" }).click();

  await expect(page.getByRole("heading", { level: 1, name: CONTACT })).toBeVisible();
});

test("a networking status is a labelled state, never a bare colour", async ({
  page,
}) => {
  await page.goto("/contacts");
  await expect(page.getByRole("link", { name: CONTACT })).toBeVisible();

  // §6's thirteen networking states are most of what this screen conveys, so
  // the status has to survive as words for anyone who cannot separate the
  // chips by hue. brand-kit calls this non-negotiable; assert it where a user
  // would actually read it — inside this contact's own row, not anywhere on a
  // page that also carries every status as a filter option.
  const row = page.getByRole("row").filter({ hasText: CONTACT });
  await expect(row.getByText("Ready to Contact")).toBeVisible();
});

test("logging a conversation puts it on the contact's timeline", async ({
  page,
}) => {
  await page.goto("/contacts");
  await page.getByRole("link", { name: CONTACT }).click();

  const log = page.getByRole("region", { name: "Log interaction" });
  await log.getByLabel("Channel", { exact: true }).selectOption("linkedin_dm");
  await log.getByLabel("Direction", { exact: true }).selectOption("outbound");
  await log
    .getByLabel("Message", { exact: true })
    .fill("Asked whether the platform team is hiring new grads.");
  await log.getByRole("button", { name: "Log interaction" }).click();

  const timeline = page.getByRole("region", { name: "Interaction timeline" });
  await expect(timeline.getByText(/platform team is hiring/)).toBeVisible();
});

test("a follow-up date set on a contact comes back on Today", async ({ page }) => {
  const today = workspaceDate();
  await page.goto("/contacts");
  await page.getByRole("link", { name: CONTACT }).click();

  const edit = page.getByRole("region", { name: "Edit contact" });
  await edit.getByLabel("Next action", { exact: true }).fill("Ask about referrals");
  await edit.getByLabel("Follow-up date", { exact: true }).fill(today);
  await edit
    .getByLabel("Networking status", { exact: true })
    .selectOption("checking_for_openings");
  await saveAndSettle(
    page,
    edit.getByRole("button", { name: "Save changes" }),
    "/api/contacts/",
  );

  await page.goto("/today");
  const doNow = page.getByRole("region", { name: "Do Now" });
  await expect(doNow.getByText(CONTACT).first()).toBeVisible();
  await expect(doNow.getByText("Ask about referrals").first()).toBeVisible();
});

test("a due contact follow-up completes once without becoming a task", async ({
  page,
}) => {
  await page.goto("/today");
  const doNow = page.getByRole("region", { name: "Do Now" });
  await saveAndSettle(
    page,
    doNow.getByRole("button", { name: "Complete: Ask about referrals" }).first(),
    "/api/today/complete",
  );
  await expect(doNow.getByText(CONTACT)).toHaveCount(0);
  await expect(page.getByText(`Follow-up completed → ${CONTACT}`)).toBeVisible();
  await page.reload();
  await expect(doNow.getByText(CONTACT)).toHaveCount(0);

  await page.goto("/tasks?status=completed");
  await expect(page.getByText("Ask about referrals")).toHaveCount(0);
});

test("marking a follow-up notification done resolves the new source action", async ({
  page,
}) => {
  await page.goto("/contacts");
  await page.getByRole("link", { name: CONTACT }).click();
  const edit = page.getByRole("region", { name: "Edit contact" });
  await edit.getByLabel("Next action", { exact: true }).fill("Send resume");
  await edit.getByLabel("Follow-up date", { exact: true }).fill(workspaceDate());
  await saveAndSettle(
    page,
    edit.getByRole("button", { name: "Save changes" }),
    "/api/contacts/",
  );

  await page.goto("/notifications");
  const row = page.getByRole("row").filter({ hasText: CONTACT });
  await expect(row).toBeVisible();
  await saveAndSettle(
    page,
    row.getByRole("button", { name: "Mark done" }),
    "/api/notifications/done",
  );

  await page.goto("/today");
  await expect(
    page.getByRole("region", { name: "Do Now" }).getByText(CONTACT),
  ).toHaveCount(0);
  await page.goto("/contacts");
  await page.getByRole("link", { name: CONTACT }).click();
  await expect(
    page
      .getByRole("region", { name: "Edit contact" })
      .getByLabel("Follow-up date", { exact: true }),
  ).toHaveValue("");
});

test("the status change survives a reload rather than living in the tab", async ({
  page,
}) => {
  await page.goto("/contacts");
  await page.getByRole("link", { name: CONTACT }).click();
  // Reloading before the click's navigation resolves would just reload the
  // list, which passes vacuously for the wrong reason.
  await expect(page.getByRole("heading", { level: 1, name: CONTACT })).toBeVisible();
  await page.reload();

  await expect(
    page
      .getByRole("region", { name: "Edit contact" })
      .getByLabel("Networking status", { exact: true }),
  ).toHaveValue("checking_for_openings");
});

test("a contact filter narrows the list and can be saved for next time", async ({
  page,
}) => {
  await page.goto("/contacts");
  await page.getByLabel("Status", { exact: true }).selectOption("checking_for_openings");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("link", { name: CONTACT })).toBeVisible();

  await page.getByLabel("Save this filter as", { exact: true }).fill("Warm leads");
  await saveAndSettle(
    page,
    page.getByRole("button", { name: "Save this filter" }),
    "/api/saved-searches",
  );

  // A saved search is only useful if it outlives the session that made it.
  await page.goto("/contacts");
  await expect(page.getByRole("link", { name: "Warm leads" })).toBeVisible();
});
