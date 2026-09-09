import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { ACCOUNT_PASSWORD, BASE_URL, FIXTURE } from "./fixture";
import { REGISTERED_PAGES } from "./routes";
import { createTotpSetup, generateTotpCode } from "../../src/server/auth/totp";

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1280, height: 900 },
] as const;
const THEMES = ["light", "dark"] as const;

function pageFiles(directory: string, root = directory): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return pageFiles(path, root);
    return entry.name === "page.tsx" ? [relative(root, path)] : [];
  });
}

function stateFiles(directory: string, filename: "error.tsx" | "loading.tsx"): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return stateFiles(path, filename);
    return entry.name === filename ? [path] : [];
  });
}

async function signIn(
  context: BrowserContext,
  username: string = FIXTURE.accountA.username,
) {
  const response = await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: { username, password: ACCOUNT_PASSWORD },
    headers: { Origin: BASE_URL },
  });
  expect(response.status()).toBe(200);
}

async function auditPage(page: Page, path: string, expectedPath = path) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.status(), path).toBeLessThan(400);
  const finalUrl = new URL(page.url());
  expect(`${finalUrl.pathname}${finalUrl.search}`, path).toBe(expectedPath);
  await expect(page.locator("main")).toBeVisible();
  const dialogExpected = path === "/add" || expectedPath.includes("auth=");
  if (dialogExpected) {
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(":focus")).toHaveCount(1);
  }

  const audit = await page.evaluate(() => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const interactive = [
      ...document.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [role="button"], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter(visible);
    const undersized = interactive
      .map((element) => {
        const control =
          element instanceof HTMLInputElement &&
          (element.type === "checkbox" || element.type === "radio")
            ? element.closest("label") ?? element
            : element;
        const rect = control.getBoundingClientRect();
        return {
          label:
            element.getAttribute("aria-label") ??
            element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ??
            element.tagName,
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
        };
      })
      .filter(({ width, height }) => width < 44 || height < 44);
    const statusWithoutIconAndLabel = [
      ...document.querySelectorAll<HTMLElement>("[data-status], [data-tone]"),
    ]
      .filter(visible)
      .filter(
        (element) =>
          !element.querySelector("svg[aria-hidden='true']") ||
          !element.textContent?.trim(),
      )
      .map((element) => element.textContent?.trim() || element.outerHTML.slice(0, 100));

    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth,
      bodyScrollWidth: document.body.scrollWidth,
      undersized,
      statusWithoutIconAndLabel,
    };
  });

  expect(audit.scrollWidth, `${path} document overflow`).toBeLessThanOrEqual(
    audit.innerWidth,
  );
  expect(audit.bodyScrollWidth, `${path} body overflow`).toBeLessThanOrEqual(
    audit.innerWidth,
  );
  expect(audit.undersized, `${path} undersized controls`).toEqual([]);
  expect(
    audit.statusWithoutIconAndLabel,
    `${path} colour-only status`,
  ).toEqual([]);

  if (dialogExpected) {
    // Keep the keyboard probe on the path a user can actually reach while the
    // page behind a modal is inert. Programmatically moving focus to <body>
    // can expose development-only controls that are outside the application.
    await page.keyboard.press("Shift+Tab");
  } else {
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
      document.body.tabIndex = -1;
      document.body.focus();
      document.body.removeAttribute("tabindex");
    });
    await page.keyboard.press("Tab");
  }
  const focus = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    const style = element ? getComputedStyle(element) : null;
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return {
      className: element?.className,
      inDialog: element?.closest('[role="dialog"]') !== null,
      outlineColor: style?.outlineColor,
      outlineStyle: style?.outlineStyle,
      outlineWidth: style?.outlineWidth,
      outlineOffset: style?.outlineOffset,
      accent,
    };
  });
  if (dialogExpected) {
    expect(focus.inDialog, `${path} deliberate focus trap`).toBe(true);
  } else {
    expect(focus.className, `${path} first focus`).toContain("skip-link");
  }
  expect(focus.outlineStyle, `${path} focus style`).toBe("solid");
  expect(focus.outlineWidth, `${path} focus width`).toBe("2px");
  expect(focus.outlineOffset, `${path} focus offset`).toBe("2px");
  expect(focus.outlineColor, `${path} focus colour`).toBe(focus.accent);
}

test("every page file is registered", () => {
  const actual = pageFiles(join(process.cwd(), "src/app")).sort();
  const registered = REGISTERED_PAGES.map(({ file }) => file).sort();
  expect(registered).toEqual(actual);
});

test("loading and error states announce their status", () => {
  const appRoot = join(process.cwd(), "src/app");
  for (const path of stateFiles(appRoot, "loading.tsx")) {
    const source = readFileSync(path, "utf8");
    expect(source, path).toContain('aria-busy="true"');
    expect(source, path).toContain("aria-label=");
  }
  for (const path of stateFiles(appRoot, "error.tsx")) {
    const source = readFileSync(path, "utf8");
    expect(source, path).toContain('role="alert"');
  }
});

test("desktop rail pairs every destination with a decorative icon", async ({ browser }) => {
  const expectedLabels = [
    "Today",
    "Companies",
    "Contacts",
    "Opportunities",
    "Referrals",
    "Applications",
    "Tasks",
    "Inbox",
    "Notifications",
    "Analytics",
    "Settings",
  ];

  for (const theme of THEMES) {
    const context = await browser.newContext({
      colorScheme: theme,
      viewport: VIEWPORTS[2],
    });
    await signIn(context);
    const page = await context.newPage();
    await page.goto("/today", { waitUntil: "domcontentloaded" });
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);

    const links = page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link");
    await expect(links).toHaveCount(expectedLabels.length);
    expect(
      await links.evaluateAll((elements) =>
        elements.map((link) => ({
          iconCount: link.querySelectorAll("svg.rail-icon[aria-hidden='true']")
            .length,
          label: link.textContent?.trim(),
        })),
      ),
    ).toEqual(
      expectedLabels.map((label) => ({ iconCount: 1, label })),
    );
    await context.close();
  }
});

test("every page fits three widths in both themes", async ({ browser }) => {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      const signedOut = await browser.newContext({ colorScheme: theme, viewport });
      const signedOutPage = await signedOut.newPage();
      await signedOutPage.goto("/login");
      await signedOutPage.evaluate((value) => localStorage.setItem("theme", value), theme);
      for (const route of REGISTERED_PAGES.filter(({ access }) => access === "signed-out")) {
        await auditPage(signedOutPage, route.path, route.expectedPath);
      }
      await signedOut.close();

      const setup = await browser.newContext({ colorScheme: theme, viewport });
      await signIn(setup, FIXTURE.accountSetup.username);
      const setupPage = await setup.newPage();
      await setupPage.goto("/setup-totp");
      await setupPage.evaluate((value) => localStorage.setItem("theme", value), theme);
      for (const route of REGISTERED_PAGES.filter(({ access }) => access === "setup")) {
        await auditPage(setupPage, route.path, route.expectedPath);
      }
      await setup.close();

      const signedIn = await browser.newContext({ colorScheme: theme, viewport });
      await signIn(signedIn);
      const signedInPage = await signedIn.newPage();
      await signedInPage.goto("/today");
      await signedInPage.evaluate((value) => localStorage.setItem("theme", value), theme);
      for (const route of REGISTERED_PAGES.filter(({ access }) => access === "signed-in")) {
        await auditPage(signedInPage, route.path, route.expectedPath);
      }
      await signedIn.close();
    }
  }
});

test("empty and not-found states fit mobile in both themes", async ({ browser }) => {
  for (const theme of THEMES) {
    const context = await browser.newContext({
      colorScheme: theme,
      viewport: VIEWPORTS[0],
    });
    await signIn(context, FIXTURE.accountEmpty.username);
    const page = await context.newPage();
    await page.goto("/today");
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    for (const route of REGISTERED_PAGES.filter(
      ({ access }) => access === "signed-in",
    )) {
      await auditPage(page, route.path, route.expectedPath);
    }
    await context.close();
  }
});

test("quick add traps focus and returns it on close", async ({ browser }) => {
  for (const viewport of [VIEWPORTS[0], VIEWPORTS[2]]) {
    const context = await browser.newContext({ viewport });
    await signIn(context);
    const page = await context.newPage();
    await page.goto("/today");
    const trigger = viewport.width < 768
      ? page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("button", { name: "Add" })
      : page.getByRole("banner").getByRole("button", { name: "Add" });
    await trigger.focus();
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await context.close();
  }
});

test("contact preview fits every width and theme with contained focus", async ({
  browser,
}) => {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ colorScheme: theme, viewport });
      await signIn(context);
      const page = await context.newPage();
      await page.goto("/contacts");
      await page.evaluate((value) => localStorage.setItem("theme", value), theme);
      await page.reload();

      const trigger = page.getByRole("button", { name: "Preview Atlas Person" });
      await trigger.focus();
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Atlas Person" });
      const close = dialog.getByRole("button", { name: "Close contact preview" });
      await expect(dialog).toBeVisible();
      await expect(close).toBeFocused();
      await expect(dialog.getByText("Checking for Openings")).toBeVisible();

      const audit = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const content = element.querySelector<HTMLElement>(".contact-preview-content");
        const controls = [
          ...element.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
        ].map((control) => {
          const bounds = control.getBoundingClientRect();
          return { height: bounds.height, width: bounds.width };
        });
        return {
          bottom: rect.bottom,
          controls,
          innerHeight,
          innerWidth,
          left: rect.left,
          pageScrollWidth: document.documentElement.scrollWidth,
          right: rect.right,
          top: rect.top,
          contentOverflow: content ? getComputedStyle(content).overflowY : null,
        };
      });
      expect(audit.left).toBeGreaterThanOrEqual(0);
      expect(audit.top).toBeGreaterThanOrEqual(0);
      expect(audit.right).toBeLessThanOrEqual(audit.innerWidth);
      expect(audit.bottom).toBeLessThanOrEqual(audit.innerHeight);
      expect(audit.pageScrollWidth).toBeLessThanOrEqual(audit.innerWidth);
      expect(audit.contentOverflow).toBe("auto");
      expect(audit.controls.every(({ height, width }) => height >= 44 && width >= 44)).toBe(
        true,
      );

      const focus = await close.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          outlineOffset: style.outlineOffset,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        };
      });
      expect(focus).toEqual({
        outlineOffset: "2px",
        outlineStyle: "solid",
        outlineWidth: "2px",
      });
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      await context.close();
    }
  }
});

test("landing account dialogs trap focus and preserve browser history", async ({ browser }) => {
  const context = await browser.newContext({ viewport: VIEWPORTS[2] });
  const page = await context.newPage();
  await page.goto("/");

  const trigger = page
    .getByRole("navigation", { name: "Landing navigation" })
    .getByRole("button", { name: "Sign in" });
  await trigger.focus();
  await trigger.click();
  await expect(page).toHaveURL(`${BASE_URL}/?auth=sign-in`);

  let dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(dialog.getByLabel("Username")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.locator(":focus")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(`${BASE_URL}/`);
  await expect(trigger).toBeFocused();

  await trigger.click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(`${BASE_URL}/?auth=forgot-password`);
  await expect(dialog.getByRole("heading", { name: "Reset password" })).toBeVisible();
  await expect(dialog.getByLabel("Username")).toBeFocused();

  await page.goBack();
  await expect(page).toHaveURL(`${BASE_URL}/?auth=sign-in`);
  await expect(dialog.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.locator(".auth-dialog-backdrop").click({ position: { x: 2, y: 2 } });
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(`${BASE_URL}/`);
  await context.close();
});

test("foreign workspace pages, search, export and files reveal nothing", async ({ browser }) => {
  const a = await browser.newContext({ viewport: VIEWPORTS[2] });
  await signIn(a);
  const pageA = await a.newPage();
  const foreignPages = [
    `/companies/${FIXTURE.b.companyId}`,
    `/contacts/${FIXTURE.b.contactId}`,
    `/opportunities/${FIXTURE.b.opportunityId}`,
    `/referrals/${FIXTURE.b.referralId}`,
  ];
  for (const path of foreignPages) {
    await pageA.goto(path);
    await expect(pageA.locator("body")).not.toContainText("Private Labs");
    await expect(pageA.locator("body")).not.toContainText("Private Person");
    await expect(pageA.locator("body")).not.toContainText("Private Platform Engineer");
  }
  await pageA.goto("/companies?q=Private%20Labs");
  await expect(pageA.locator("body")).not.toContainText("Private Labs");
  const exported = await a.request.get(`${BASE_URL}/api/export?set=all&format=json`);
  expect(exported.status()).toBe(200);
  expect(await exported.text()).not.toContain("Private Labs");
  const file = await a.request.get(
    `${BASE_URL}/api/document-versions/${FIXTURE.b.versionId}/file`,
  );
  expect(file.status()).toBe(404);

  const b = await browser.newContext({ viewport: VIEWPORTS[2] });
  await signIn(b, FIXTURE.accountB.username);
  const pageB = await b.newPage();
  await pageB.goto(`/companies/${FIXTURE.b.companyId}`);
  await expect(pageB.getByRole("heading", { name: "Private Labs" })).toBeVisible();
  await b.close();
  await a.close();
});

test("signup setup cannot reach workspace data and confirmation promotes it", async ({ browser }) => {
  const context = await browser.newContext({ viewport: VIEWPORTS[0] });
  await signIn(context, FIXTURE.accountSetup.username);
  const page = await context.newPage();

  await page.goto("/today");
  await expect(page).toHaveURL(/\/\?auth=setup-totp$/u);
  await expect(page.getByText("Step 2 of 2", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Authenticator setup QR code")).toBeVisible();
  await expect(page.getByText("Skip for now", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel account setup" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator(".auth-dialog-backdrop").click({ position: { x: 2, y: 2 } });
  await expect(page.getByRole("dialog")).toBeVisible();

  const before = await context.request.get(`${BASE_URL}/api/companies`);
  expect(before.status()).toBe(401);

  const secret = createTotpSetup(
    FIXTURE.accountSetup.username,
    Buffer.from("12345678901234567890", "ascii"),
  ).secret;
  const validCode = generateTotpCode(secret);
  const invalidCode = validCode === "000000" ? "000001" : "000000";
  const code = page.getByLabel("Six-digit code");
  await code.fill(invalidCode);
  await page.getByRole("button", { name: "Enable authenticator" }).click();
  await expect(page.locator(".form-alert")).toContainText(
    "That authenticator code could not be confirmed.",
  );
  await expect(code).toBeFocused();

  await code.fill(validCode);
  await page.getByRole("button", { name: "Enable authenticator" }).click();
  await expect(page).toHaveURL(`${BASE_URL}/today`);
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();

  const after = await context.request.get(`${BASE_URL}/api/companies`);
  expect(after.status()).toBe(200);
  await context.close();
});

test("incomplete signup can be kept or explicitly deleted at mobile width", async ({ browser }) => {
  for (const theme of THEMES) {
    const username = `abandon_check_${theme}`;
    const context = await browser.newContext({
      colorScheme: theme,
      viewport: VIEWPORTS[0],
    });
    const page = await context.newPage();

    async function beginSignup() {
      await page.goto("/");
      await page.evaluate((value) => localStorage.setItem("theme", value), theme);
      await page.reload();
      await page.getByRole("button", { name: "Create your workspace" }).click();
      await page.getByLabel("Username").fill(username);
      await page.getByLabel("Password", { exact: true }).fill(ACCOUNT_PASSWORD);
      await page.getByLabel("Confirm password").fill(ACCOUNT_PASSWORD);
      await page.getByRole("button", { name: "Continue to authenticator" }).click();
      await expect(page).toHaveURL(/\/?\?auth=setup-totp$/u);
      await expect(page.getByText("Step 2 of 2", { exact: true })).toBeVisible();
    }

    await beginSignup();
    const qrPath = await page
      .getByLabel("Authenticator setup QR code")
      .locator("path")
      .getAttribute("d");
    await page.getByRole("button", { name: "Cancel account setup" }).click();
    await expect(page.getByRole("heading", { name: "Delete incomplete account?" })).toBeVisible();
    await expect(page.getByText("This cannot be undone", { exact: true })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.locator(".auth-dialog-backdrop").click({ position: { x: 2, y: 2 } });
    await expect(page.getByRole("heading", { name: "Delete incomplete account?" })).toBeVisible();

    await page.getByRole("button", { name: "Keep setting up" }).click();
    await expect(page.getByText("Step 2 of 2", { exact: true })).toBeVisible();
    await expect(
      page.getByLabel("Authenticator setup QR code").locator("path"),
    ).toHaveAttribute("d", qrPath ?? "");

    await page.getByRole("button", { name: "Cancel account setup" }).click();
    await page.getByRole("button", { name: "Delete incomplete account" }).click();
    await expect(page).toHaveURL(`${BASE_URL}/`);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await context.request.get(`${BASE_URL}/api/companies`)).status()).toBe(401);

    await beginSignup();
    await page.getByRole("button", { name: "Cancel account setup" }).click();
    await page.getByRole("button", { name: "Delete incomplete account" }).click();
    await expect(page).toHaveURL(`${BASE_URL}/`);
    await context.close();
  }
});

// D-063. The complaint that started this was measurable — the records began
// roughly 620 CSS pixels down a 1280-wide page — so the fix is measured rather
// than eyeballed, and the filter panel is proved to be genuinely operable from
// the keyboard rather than merely collapsed.
test("list controls stay one toolbar and keep the records near the top", async ({
  browser,
}) => {
  const lists = [
    { path: "/opportunities", records: "Opportunities" },
    { path: "/contacts", records: "Contacts" },
    { path: "/referrals", records: "Referral requests" },
  ] as const;

  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ colorScheme: theme, viewport });
      await signIn(context);
      const page = await context.newPage();

      for (const list of lists) {
        await page.goto(list.path);
        const panel = page.locator(".list-toolbar__panel");
        await expect(panel, `${list.path} opens closed`).toBeHidden();

        const offset = await page.evaluate(() => {
          const main = document.querySelector("main");
          const toolbar = document.querySelector(".list-toolbar");
          const records = toolbar?.nextElementSibling;
          if (!main || !records) return null;
          return (
            records.getBoundingClientRect().top -
            main.getBoundingClientRect().top
          );
        });
        expect(offset, `${list.path} at ${viewport.width}`).not.toBeNull();
        expect(offset ?? 0, `${list.path} at ${viewport.width}`).toBeLessThan(
          viewport.width < 768 ? 400 : 320,
        );

        // The disclosure is a real control: reachable, operable by keyboard, and
        // it opens without pushing the page sideways.
        const summary = page.locator(".list-toolbar__summary");
        await summary.focus();
        await expect(summary).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(panel).toBeVisible();
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(overflow, `${list.path} open at ${viewport.width}`).toBeLessThanOrEqual(1);
        await page.keyboard.press("Enter");
        await expect(panel).toBeHidden();
      }

      await context.close();
    }
  }
});

test("an applied filter is stated as a chip that clears only itself", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: VIEWPORTS[2] });
  await signIn(context);
  const page = await context.newPage();

  await page.goto("/contacts?relationship=alumni&status=checking_for_openings");
  await expect(page.locator(".list-toolbar__badge")).toHaveText("2 applied");
  const chips = page.getByRole("list", { name: "Applied contact filters" });
  await expect(chips.getByRole("link", { name: /Remove the Relationship/ })).toBeVisible();

  await chips.getByRole("link", { name: /Remove the Status/ }).click();
  await expect(page).toHaveURL(`${BASE_URL}/contacts?relationship=alumni`);
  await expect(page.locator(".list-toolbar__badge")).toHaveText("1 applied");

  await page.getByRole("link", { name: "Clear all" }).click();
  await expect(page).toHaveURL(`${BASE_URL}/contacts`);
  await expect(page.locator(".list-toolbar__badge")).toHaveCount(0);
  await context.close();
});

// D-064. The point of one card grid is that a record renders once, so the count
// of triggers is the check that matters most — a passing render tells you
// nothing about whether the table's hidden twin came back.
test("records render once as cards at every width and theme", async ({
  browser,
}) => {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ colorScheme: theme, viewport });
      await signIn(context);
      const page = await context.newPage();

      for (const path of ["/contacts", "/opportunities", "/companies"]) {
        await page.goto(path);
        await expect(page.locator("table"), path).toHaveCount(0);
        const cards = page.locator(".record-card");
        expect(await cards.count(), path).toBeGreaterThan(0);

        // Every destination is either a real link to elsewhere or a control that
        // says why it cannot act. Neither may be a dead or nameless button.
        const actions = await page.locator(".record-action").all();
        expect(actions.length, path).toBeGreaterThan(0);
        for (const action of actions) {
          const box = await action.boundingBox();
          expect(box?.height ?? 0, path).toBeGreaterThanOrEqual(44);
          const text = (await action.innerText()).trim();
          expect(text.length, path).toBeGreaterThan(0);
          if ((await action.evaluate((el) => el.tagName)) === "A") {
            expect(await action.getAttribute("href"), path).toBeTruthy();
          } else {
            await expect(action, path).toBeDisabled();
          }
        }

        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(overflow, `${path} at ${viewport.width}`).toBeLessThanOrEqual(1);
      }

      await context.close();
    }
  }
});

test("a card's saved destination opens in its own tab", async ({ browser }) => {
  const context = await browser.newContext({ viewport: VIEWPORTS[2] });
  await signIn(context);
  const page = await context.newPage();
  await page.goto("/contacts");

  // `a.record-action`, not `.record-action`: a record without the destination
  // renders a disabled button carrying the same word, and this test is about
  // the saved one.
  const linkedin = page
    .locator("a.record-action")
    .filter({ hasText: "LinkedIn" })
    .first();
  await expect(linkedin).toHaveAttribute("target", "_blank");
  await expect(linkedin).toHaveAttribute("rel", "noopener noreferrer");

  await page.goto("/companies");
  const website = page
    .locator("a.record-action")
    .filter({ hasText: "Website" })
    .first();
  await expect(website).toHaveAttribute("target", "_blank");
  await context.close();
});

// The owner's /companies screenshot: two cards in one row were taller than the
// third because a contact count that links is a 44px target and plain "0
// contacts" is not. Height is measured per surface, across rows rather than
// within one, because a grid sizes its rows independently.
test("cards in one list are one size", async ({ browser }) => {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ colorScheme: theme, viewport });
      await signIn(context);
      const page = await context.newPage();

      for (const path of ["/contacts", "/opportunities", "/companies"]) {
        await page.goto(path);
        const heights = await page
          .locator(".record-card")
          .evaluateAll((cards) =>
            cards.map((card) => Math.round(card.getBoundingClientRect().height)),
          );
        expect(heights.length, path).toBeGreaterThan(0);
        expect(
          new Set(heights).size,
          `${path} at ${viewport.width} ${theme}: ${heights.join(", ")}`,
        ).toBe(1);

        // Equal height must not be bought by clipping what a card has to say.
        const clipped = await page
          .locator(".record-card")
          .evaluateAll((cards) =>
            cards.filter((card) => card.scrollHeight > card.clientHeight + 1)
              .length,
          );
        expect(clipped, path).toBe(0);

        // The footer sits on the bottom edge, not floating under short content.
        const gaps = await page.locator(".record-card").evaluateAll((cards) =>
          cards.flatMap((card) => {
            const foot = card.querySelector(".record-card__foot");
            if (!foot) return [];
            return [
              Math.round(
                card.getBoundingClientRect().bottom -
                  foot.getBoundingClientRect().bottom,
              ),
            ];
          }),
        );
        for (const gap of gaps) expect(gap, path).toBeLessThanOrEqual(2);
      }

      await context.close();
    }
  }
});
