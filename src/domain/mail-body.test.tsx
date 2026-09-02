import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { inboundMailBodyText } from "./mail-body";

function productionComponents(directory: string, root = directory): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return productionComponents(path, root);
    }
    if (!entry.name.endsWith(".tsx") || entry.name.endsWith(".test.tsx")) {
      return [];
    }
    return [relative(root, path)];
  });
}

describe("inbound mail body boundary", () => {
  it("preserves text/plain and React renders hostile-looking text literally", () => {
    const body = '<script>alert("x")</script><img src=x onerror="alert(1)">';
    const text = inboundMailBodyText({
      contentType: "text/plain; charset=utf-8",
      body,
    });
    const rendered = renderToStaticMarkup(<article>{text}</article>);

    expect(text).toBe(body);
    expect(rendered).toContain("&lt;script&gt;");
    expect(rendered).toContain("onerror=&quot;alert(1)&quot;");
    expect(rendered).not.toContain("<script>");
    expect(rendered).not.toContain("<img");
  });

  it("turns text/html into readable text without tags, attributes, or raw-content blocks", () => {
    const text = inboundMailBodyText({
      contentType: "TEXT/HTML; charset=UTF-8",
      body: [
        "<head><style>body { display: none }</style></head>",
        '<p>Hello&nbsp;<strong>Rahul</strong><img src=x onerror="steal()"></p>',
        "<script>steal()</script>",
        "<div>Next &amp; safe<br>line &#x1F44B;</div>",
      ].join(""),
    });

    expect(text).toBe("Hello Rahul\n\nNext & safe\nline 👋");
    expect(text).not.toMatch(/script|style|onerror|<|>/i);
  });

  it("does not guess how to render an unsupported body type", () => {
    expect(
      inboundMailBodyText({
        contentType: "application/xhtml+xml",
        body: "<p>Not accepted as mail text</p>",
      }),
    ).toBe("");
  });

  it("keeps production components off direct HTML injection APIs", () => {
    const root = join(process.cwd(), "src");
    const offenders = productionComponents(root).filter((file) => {
      const source = readFileSync(join(root, file), "utf8");
      return /dangerouslySetInnerHTML|\.innerHTML\s*=/.test(source);
    });

    expect(offenders).toEqual([]);
  });
});
