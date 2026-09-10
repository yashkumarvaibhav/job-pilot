import { expect, test, type BrowserContext } from "@playwright/test";
import { ACCOUNT_PASSWORD, BASE_URL, FIXTURE } from "./fixture";
async function signIn(context: BrowserContext) {
    const result = await context.request.post(`${BASE_URL}/api/auth/login`, {
        data: { username: FIXTURE.accountA.username, password: ACCOUNT_PASSWORD }, headers: { Origin: BASE_URL },
    });
    expect(result.status()).toBe(200);
}
const surfaces = ["/today", "/companies", "/contacts", "/opportunities", "/applications", "/referrals", "/tasks", "/notifications",
    `/companies/${FIXTURE.a.companyId}`, `/contacts/${FIXTURE.a.contactId}`, `/opportunities/${FIXTURE.a.opportunityId}`, `/referrals/${FIXTURE.a.referralId}`];
test("every record link across lists and related sections previews over the original page", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await signIn(context);
    const page = await context.newPage();
    for (const path of surfaces) {
        await page.goto(path);
        await expect(page.locator("main")).toBeVisible();
        const links = page.locator('main a[href]').filter({ visible: true });
        const hrefs = await links.evaluateAll((nodes) => [...new Set(nodes.map((node) => node.getAttribute("href")!).filter((href) => /^\/(companies|contacts|opportunities|referrals)\/[^/?#]+/.test(href)))]);
        for (const href of hrefs) {
            const trigger = page.locator(`main a[href="${href}"]`).filter({ visible: true }).first();
            await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
            await expect(trigger).toHaveAttribute("data-preview-ready", "true");
            const url = page.url();
            await trigger.click();
            const dialog = page.getByRole("dialog");
            await expect(dialog).toBeVisible();
            await expect(dialog.locator("dl").first()).toBeVisible();
            await expect(dialog.getByRole("alert")).toHaveCount(0);
            await expect(page).toHaveURL(url);
            await expect(dialog.getByRole("link", { name: /Open .* in new tab/ }).last()).toHaveAttribute("href", href);
            await page.keyboard.press("Escape");
            await expect(dialog).toHaveCount(0);
            await expect(trigger).toBeFocused();
        }
    }
    await context.close();
});
test("record popups contain focus, fit both themes and retain full-page section destinations", async ({ browser }) => {
    for (const theme of ["light", "dark"] as const)
        for (const width of [390, 768, 1280]) {
            const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
            await signIn(context);
            const page = await context.newPage();
            for (const [path, href, kind] of [["/companies", `/companies/${FIXTURE.a.companyId}`, "company"], ["/opportunities", `/opportunities/${FIXTURE.a.opportunityId}`, "opportunity"], ["/referrals", `/referrals/${FIXTURE.a.referralId}`, "referral"], ["/applications", `/opportunities/${FIXTURE.a.opportunityId}#application`, "opportunity"]]) {
                await page.goto(path);
                const trigger = page.locator(`main a[href="${href}"]`).filter({ visible: true }).first();
                await expect(trigger).toHaveAttribute("data-preview-ready", "true");
                await trigger.focus();
                await page.keyboard.press("Enter");
                const dialog = page.getByRole("dialog");
                await expect(dialog.locator("dl").first()).toBeVisible();
                const close = dialog.getByRole("button", { name: `Close ${kind} preview` });
                await expect(close).toBeFocused();
                for (let n = 0; n < 12; n++) {
                    await page.keyboard.press("Tab");
                    await expect(dialog.locator(":focus")).toHaveCount(1);
                }
                const bounds = await dialog.evaluate((node) => {
                    const rect = node.getBoundingClientRect();
                    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, scroll: document.documentElement.scrollWidth,
                        controls: [...node.querySelectorAll("button, a")].map((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; }) };
                });
                expect(bounds.left).toBeGreaterThanOrEqual(0);
                expect(bounds.top).toBeGreaterThanOrEqual(0);
                expect(bounds.right).toBeLessThanOrEqual(width);
                expect(bounds.bottom).toBeLessThanOrEqual(900);
                expect(bounds.scroll).toBeLessThanOrEqual(width);
                expect(bounds.controls.every((r) => r.w >= 44 && r.h >= 44)).toBe(true);
                if (width === 1280 && theme === "light") {
                    const [full] = await Promise.all([page.waitForEvent("popup"), dialog.getByRole("link", { name: `Open ${kind} in new tab` }).click()]);
                    await expect(full.locator("h1")).toBeVisible();
                    expect(new URL(full.url()).pathname + new URL(full.url()).hash).toBe(href);
                    await full.close();
                }
                if (path === "/companies")
                    await page.screenshot({ path: `/tmp/jp-preview-${theme}-${width}.png` });
                await close.click();
                await expect(dialog).toHaveCount(0);
                await expect(trigger).toBeFocused();
            }
            await context.close();
        }
});
test("previews handle loading, offline retry, missing and foreign records without navigation", async ({ browser }) => {
    const context = await browser.newContext();
    await signIn(context);
    const page = await context.newPage();
    await page.goto("/opportunities");
    const trigger = page.locator(`a[href="/opportunities/${FIXTURE.a.opportunityId}"]`).first();
    await expect(trigger).toHaveAttribute("data-preview-ready", "true");
    let resume!: () => void;
    const pending = new Promise<void>((resolve) => { resume = resolve; });
    await page.route(`**/api/opportunities/${FIXTURE.a.opportunityId}`, async (route) => { await pending; await route.abort(); });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Loading opportunity preview…")).toBeVisible();
    resume();
    await expect(dialog.getByText("Could not load this opportunity")).toBeVisible();
    await page.unroute(`**/api/opportunities/${FIXTURE.a.opportunityId}`);
    await dialog.getByRole("button", { name: "Retry" }).click();
    await expect(dialog.getByText("Atlas Platform Engineer", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    for (const id of [FIXTURE.b.opportunityId, "missing-record"]) {
        await page.route(`**/api/opportunities/${FIXTURE.a.opportunityId}`, async (route) => {
            const result = await context.request.get(`/api/opportunities/${id}`);
            expect(result.status()).toBe(404);
            await route.fulfill({ response: result });
        });
        await trigger.click();
        await expect(dialog.getByText("Opportunity not found", { exact: true })).toBeVisible();
        await expect(dialog).not.toContainText("Private");
        await page.keyboard.press("Escape");
        await page.unroute(`**/api/opportunities/${FIXTURE.a.opportunityId}`);
    }
    await context.close();
});
test("company relations, command results and external card destinations preserve context", async ({ browser }) => {
    const context = await browser.newContext();
    await signIn(context);
    const page = await context.newPage();
    await page.goto("/companies");
    const companyCount = page.locator(`a[href="/companies/${FIXTURE.a.companyId}#company-contacts"]`);
    await expect(companyCount).toHaveAttribute("data-preview-ready", "true");
    await companyCount.click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Contacts (1)" })).toBeVisible();
    await dialog.getByRole("link", { name: "Atlas Person" }).click();
    await expect(dialog.getByText("Checking for Openings")).toBeVisible();
    await dialog.getByRole("button", { name: /Back to/ }).click();
    await expect(dialog.getByRole("heading", { name: "Contacts (1)" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "Preview Website" }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("https://atlas.invalid.test");
    await expect(dialog.getByRole("link", { name: "Open page in new tab" })).toHaveAttribute("target", "_blank");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open command palette" }).click();
    await page.getByPlaceholder("Search contacts, jobs, or actions").fill("Atlas Person");
    await page.getByRole("option", { name: "Atlas Person" }).click();
    await expect(page.getByRole("dialog").getByText("Checking for Openings")).toBeVisible();
    await expect(page).toHaveURL(/\/companies$/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open command palette" })).toBeFocused();
    await context.close();
});
