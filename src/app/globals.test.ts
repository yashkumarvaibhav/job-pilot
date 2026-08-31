import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(join(process.cwd(), "src/app/globals.css"), {
  encoding: "utf8",
});
const tokensCss = readFileSync(
  join(process.cwd(), "src/styles/tokens.css"),
  "utf8",
);

/**
 * D-041. The kit's Tailwind bridge names some tokens after Tailwind's own
 * namespaces, so Tailwind emits `:root { --font-serif: var(--font-serif) }` for
 * them. Imported after the kit, those self-references win the cascade and the
 * type, radius and shadow scales all resolve to nothing — headings silently
 * lose Newsreader and every card, button and input renders square.
 */
describe("globals.css import order", () => {
  it("loads tailwindcss before the brand kit", () => {
    const tailwind = globalsCss.indexOf('@import "tailwindcss"');
    const tokens = globalsCss.indexOf("tokens.css");

    expect(tailwind).toBeGreaterThanOrEqual(0);
    expect(tokens).toBeGreaterThanOrEqual(0);
    expect(tailwind).toBeLessThan(tokens);
  });

  it("still relies on tokens whose names collide with a Tailwind namespace", () => {
    const bridge = tokensCss.slice(tokensCss.indexOf("@theme inline"));

    for (const token of [
      "--font-serif",
      "--font-sans",
      "--font-mono",
      "--radius-sm",
      "--radius-md",
      "--radius-lg",
      "--shadow-sm",
      "--shadow",
      "--shadow-lg",
    ]) {
      expect(bridge, token).toContain(`${token}: var(${token});`);
    }
  });
});
