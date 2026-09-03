import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { ACCOUNT_PASSWORD, BASE_URL, FIXTURE } from "./fixture";
import { REGISTERED_PAGES } from "./routes";

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
  email: string = FIXTURE.accountA.email,
) {
  const response = await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: { email, password: ACCOUNT_PASSWORD },
    headers: { Origin: BASE_URL },
  });
  expect(response.status()).toBe(200);
}

async function auditPage(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.status(), path).toBeLessThan(400);
  expect(page.url(), path).toContain(path.split("?")[0]!);
  await expect(page.locator("main")).toBeVisible();
  if (path === "/add") {
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

  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute("tabindex");
  });
  await page.keyboard.press("Tab");
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
  if (path === "/add") {
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
    await page.goto("/", { waitUntil: "domcontentloaded" });
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
        await auditPage(signedOutPage, route.path);
      }
      await signedOut.close();

      const signedIn = await browser.newContext({ colorScheme: theme, viewport });
      await signIn(signedIn);
      const signedInPage = await signedIn.newPage();
      await signedInPage.goto("/");
      await signedInPage.evaluate((value) => localStorage.setItem("theme", value), theme);
      for (const route of REGISTERED_PAGES.filter(({ access }) => access === "signed-in")) {
        await auditPage(signedInPage, route.path);
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
    await signIn(context, FIXTURE.accountEmpty.email);
    const page = await context.newPage();
    await page.goto("/");
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    for (const route of REGISTERED_PAGES.filter(
      ({ access }) => access === "signed-in",
    )) {
      await auditPage(page, route.path);
    }
    await context.close();
  }
});

test("quick add traps focus and returns it on close", async ({ browser }) => {
  for (const viewport of [VIEWPORTS[0], VIEWPORTS[2]]) {
    const context = await browser.newContext({ viewport });
    await signIn(context);
    const page = await context.newPage();
    await page.goto("/");
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
  await signIn(b, FIXTURE.accountB.email);
  const pageB = await b.newPage();
  await pageB.goto(`/companies/${FIXTURE.b.companyId}`);
  await expect(pageB.getByRole("heading", { name: "Private Labs" })).toBeVisible();
  await b.close();
  await a.close();
});
