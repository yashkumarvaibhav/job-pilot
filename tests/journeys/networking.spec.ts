import { expect, test, type Page } from "@playwright/test";

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

async function openContactDetailFromList(page: Page) {
  await page.goto("/contacts");
  await page.getByRole("button", { name: `Preview ${CONTACT}` }).click();
  const dialog = page.getByRole("dialog", { name: CONTACT });
  await expect(dialog).toBeVisible();
  const popup = page.waitForEvent("popup");
  await dialog.getByRole("link", { name: "Open contact in new tab" }).click();
  const detail = await popup;
  await expect(detail.getByRole("heading", { level: 1, name: CONTACT })).toBeVisible();
  return detail;
}

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
  await form.getByLabel("LinkedIn", { exact: true }).fill("linkedin.com/in/ananya-rao");
  await form
    .getByLabel("Other", { exact: true })
    .fill("https://profile.invalid.test/ananya");
  await form.getByRole("button", { name: "Save contact" }).click();

  await expect(page.getByRole("heading", { level: 1, name: CONTACT })).toBeVisible();
});

test("a networking status is a labelled state, never a bare colour", async ({
  page,
  }) => {
    await page.goto("/contacts");
    await expect(
      page.getByRole("button", { name: `Preview ${CONTACT}` }),
    ).toBeVisible();

  // §6's thirteen networking states are most of what this screen conveys, so
  // the status has to survive as words for anyone who cannot separate the
  // chips by hue. brand-kit calls this non-negotiable; assert it where a user
  // would actually read it — inside this contact's own card, not anywhere on a
  // page that also carries every status as a filter option.
  const card = page.getByRole("listitem").filter({ hasText: CONTACT });
  await expect(card.getByText("Ready to Contact")).toBeVisible();
  });

test("contact preview preserves the list and opens details and profiles in new tabs", async ({
  page,
}) => {
  await page.goto("/contacts?status=ready_to_contact");
  const trigger = page.getByRole("button", { name: `Preview ${CONTACT}` });
  await trigger.focus();
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: CONTACT });
  const closeIcon = dialog.getByRole("button", { name: "Close contact preview" });
  await expect(page).toHaveURL(/\/contacts\?status=ready_to_contact$/u);
  await expect(dialog).toBeVisible();
  await expect(closeIcon).toBeFocused();
  await expect(dialog.getByText("Halcyon Systems")).toBeVisible();
  await expect(dialog.getByText("Ready to Contact")).toBeVisible();

  const linkedin = dialog.getByRole("link", {
    name: "Open LinkedIn profile in a new tab",
  });
  const otherProfile = dialog.getByRole("link", {
    name: "Open external profile in a new tab",
  });
  await expect(linkedin).toHaveAttribute(
    "href",
    "https://linkedin.com/in/ananya-rao",
  );
  await expect(linkedin).toHaveAttribute("target", "_blank");
  await expect(linkedin).toHaveAttribute("rel", "noopener noreferrer");
  await expect(otherProfile).toHaveAttribute(
    "href",
    "https://profile.invalid.test/ananya",
  );
  await page.context().route("https://linkedin.com/**", async (route) => {
    await route.fulfill({ body: "Profile destination", contentType: "text/plain" });
  });
  const profilePopup = page.waitForEvent("popup");
  await linkedin.click();
  const profile = await profilePopup;
  await expect(profile).toHaveURL("https://linkedin.com/in/ananya-rao");
  await profile.close();

  const footerClose = dialog.getByRole("button", { name: "Close", exact: true });
  await footerClose.focus();
  await page.keyboard.press("Tab");
  await expect(closeIcon).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  const reopened = page.getByRole("dialog", { name: CONTACT });
  const detailPopup = page.waitForEvent("popup");
  await reopened.getByRole("link", { name: "Open contact in new tab" }).click();
  const detail = await detailPopup;
  await expect(detail).toHaveURL(/\/contacts\//u);
  await expect(detail.getByRole("heading", { level: 1, name: CONTACT })).toBeVisible();
  await detail.close();

  await reopened.getByRole("button", { name: "Close", exact: true }).click();
  await expect(reopened).toBeHidden();
  await expect(page).toHaveURL(/\/contacts\?status=ready_to_contact$/u);
});

test("logging a conversation puts it on the contact's timeline", async ({
  page,
}) => {
  const contactPage = await openContactDetailFromList(page);

  const log = contactPage.getByRole("region", { name: "Log interaction" });
  await log.getByLabel("Channel", { exact: true }).selectOption("linkedin_dm");
  await log.getByLabel("Direction", { exact: true }).selectOption("outbound");
  await log
    .getByLabel("Message", { exact: true })
    .fill("Asked whether the platform team is hiring new grads.");
  await log.getByRole("button", { name: "Log interaction" }).click();

  const timeline = contactPage.getByRole("region", { name: "Interaction timeline" });
  await expect(timeline.getByText(/platform team is hiring/)).toBeVisible();
  await contactPage.close();
});

test("a follow-up date set on a contact comes back on Today", async ({ page }) => {
  const today = workspaceDate();
  const contactPage = await openContactDetailFromList(page);

  const edit = contactPage.getByRole("region", { name: "Edit contact" });
  await edit.getByLabel("Next action", { exact: true }).fill("Ask about referrals");
  await edit.getByLabel("Follow-up date", { exact: true }).fill(today);
  await edit
    .getByLabel("Networking status", { exact: true })
    .selectOption("checking_for_openings");
  await saveAndSettle(
    contactPage,
    edit.getByRole("button", { name: "Save changes" }),
    "/api/contacts/",
  );
  await contactPage.close();

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
  const contactPage = await openContactDetailFromList(page);
  const edit = contactPage.getByRole("region", { name: "Edit contact" });
  await edit.getByLabel("Next action", { exact: true }).fill("Send resume");
  await edit.getByLabel("Follow-up date", { exact: true }).fill(workspaceDate());
  await saveAndSettle(
    contactPage,
    edit.getByRole("button", { name: "Save changes" }),
    "/api/contacts/",
  );
  await contactPage.close();

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
  const reloadedContact = await openContactDetailFromList(page);
  await expect(
    reloadedContact
      .getByRole("region", { name: "Edit contact" })
      .getByLabel("Follow-up date", { exact: true }),
  ).toHaveValue("");
  await reloadedContact.close();
});

test("the status change survives a reload rather than living in the tab", async ({
  page,
}) => {
  const contactPage = await openContactDetailFromList(page);
  // Reloading before the click's navigation resolves would just reload the
  // list, which passes vacuously for the wrong reason.
  await expect(
    contactPage.getByRole("heading", { level: 1, name: CONTACT }),
  ).toBeVisible();
  await contactPage.reload();

  await expect(
    contactPage
      .getByRole("region", { name: "Edit contact" })
      .getByLabel("Networking status", { exact: true }),
  ).toHaveValue("checking_for_openings");
  await contactPage.close();
});

test("a contact filter narrows the list and can be saved for next time", async ({
  page,
}) => {
  await page.goto("/contacts");
  // The fields live behind the toolbar's disclosure now (D-063), so filtering
  // starts by opening it — and the applied filter is stated without reopening it.
  // <summary> has no portable ARIA role, so this one control is addressed by
  // class; every assertion below it is still role- or label-based.
  const openFilters = page.locator(".list-toolbar__summary");
  await openFilters.click();
  await page.getByLabel("Status", { exact: true }).selectOption("checking_for_openings");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByRole("button", { name: `Preview ${CONTACT}` }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Remove the Status filter/ }),
  ).toBeVisible();

  await openFilters.click();
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
