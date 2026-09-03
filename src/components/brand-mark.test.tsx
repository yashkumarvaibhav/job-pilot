import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => router,
}));
vi.mock("next/dynamic", () => ({
  default: () =>
    function PaletteStub() {
      return null;
    },
}));

import { AppShell } from "./app-shell";
import { BrandMark, JP_MONOGRAM_PATH } from "./brand-mark";

const iconSvg = readFileSync(join(process.cwd(), "src/app/icon.svg"), "utf8");
const tokensCss = readFileSync(
  join(process.cwd(), "src/styles/tokens.css"),
  "utf8",
);

/**
 * D-047. The mark lives in two files because a favicon is a separate document:
 * the component for the page, `icon.svg` for the platform. Nothing enforces
 * that at build time, so these assert it instead — a redraw that lands in one
 * file and not the other fails here rather than shipping two logos.
 */
describe("JP monogram", () => {
  it("shares one geometry between the component and the platform icon", () => {
    const iconPath = /\sd="([^"]+)"/.exec(iconSvg)?.[1];

    expect(iconPath).toBe(JP_MONOGRAM_PATH);
  });

  it("draws the P counter as a hole rather than a filled blob", () => {
    // Three subpaths: the J, the P, and the P's counter. Non-zero winding would
    // fill that counter solid, so the rule is load-bearing, not decoration.
    expect(JP_MONOGRAM_PATH.match(/M/g) ?? []).toHaveLength(3);
    expect(renderToStaticMarkup(<BrandMark />)).toContain('fill-rule="evenodd"');
    expect(iconSvg).toContain('fill-rule="evenodd"');
  });

  it("paints the platform icon with the kit's own identity swatch", () => {
    const brand = /--brand:\s*(#[0-9a-f]{6})/i.exec(tokensCss)?.[1];

    expect(brand).toBeTruthy();
    expect(iconSvg).toContain(`fill="${brand}"`);
  });

  it("takes its page colour from currentColor so one path serves both themes", () => {
    const html = renderToStaticMarkup(<BrandMark />);

    expect(html).toContain('fill="currentColor"');
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("stays decorative, never the accessible name", () => {
    const html = renderToStaticMarkup(<BrandMark />);

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
  });
});

describe("brand lockup", () => {
  it("pairs the mark with the wordmark and no kicker line", () => {
    const html = renderToStaticMarkup(
      <AppShell quickAddData={{ companies: [], contacts: [], opportunities: [], today: "2026-09-03" }}>
        <p>Workspace</p>
      </AppShell>,
    );
    const lockup = html.slice(
      html.indexOf('class="brand-lockup"'),
      html.indexOf("</header>"),
    );

    expect(lockup).toContain('class="brand-mark"');
    expect(lockup).toContain("<strong>Job Pilot</strong>");
    expect(lockup).not.toContain("<small>");
    expect(html).not.toContain("Off-campus");
  });

  it("keeps the link's own label as the accessible name", () => {
    const html = renderToStaticMarkup(
      <AppShell quickAddData={{ companies: [], contacts: [], opportunities: [], today: "2026-09-03" }}>
        <p>Workspace</p>
      </AppShell>,
    );

    expect(html).toContain('aria-label="Job Pilot home"');
  });
});
