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

import CommandPalette from "./command-palette";
import { SavedSearchPanel } from "./saved-search-panel";

describe("command palette", () => {
  it("lazy-loads the cmdk module from the shell instead of the eager Today graph", () => {
    const directory = import.meta.dirname;
    const shell = readFileSync(join(directory, "app-shell.tsx"), "utf8");
    const host = readFileSync(join(directory, "command-palette-host.tsx"), "utf8");
    expect(shell).toContain("command-palette-host");
    expect(shell).not.toMatch(/from ["']\.\/command-palette["']/);
    expect(host).toMatch(/dynamic\(\s*\(\) => import\(["']\.\/command-palette["']\)/);
    expect(host).not.toMatch(/from ["']\.\/command-palette["']/);
  });

  it("renders rail jumps, Add job, Rahul, and High Priority in the overlay", () => {
    const html = renderToStaticMarkup(
      <CommandPalette
        catalog={{
          companies: [],
          contacts: [{ id: "rahul", name: "Rahul Sharma" }],
          opportunities: [],
          savedSearches: [
            {
              id: "high",
              name: "High Priority",
              href: "/opportunities?priority=High",
              entityType: "opportunities",
            },
          ],
        }}
        onOpenChange={() => undefined}
        onQuickAdd={() => undefined}
        open
        returnFocusTo={null}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Command palette");
    expect(html).toContain('class="command-palette"');
    expect(html).toContain("Rahul Sharma");
    expect(html).toContain("High Priority");
    expect(html).toContain("Add job");
    expect(html).toContain("Today");
    expect(html).toContain('data-dialog-initial-focus');
  });

  it("lists saved searches and a save control on the relevant page", () => {
    const html = renderToStaticMarkup(
      <SavedSearchPanel
        entityType="opportunities"
        query="priority=High"
        searches={[
          {
            id: "high",
            name: "High Priority",
            href: "/opportunities?priority=High",
          },
        ]}
      />,
    );
    expect(html).toContain("Save this filter");
    expect(html).toContain("High Priority");
    expect(html).toContain("/opportunities?priority=High");
    expect(html).toContain('placeholder="High Priority"');
  });
});
