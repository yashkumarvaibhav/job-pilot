import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PreviewLink, previewTarget, previewable } from "./record-preview";

describe("preview targets", () => {
  it("reads every record kind, keeping its section anchor", () => {
    expect(previewTarget("/contacts/rahul")).toEqual({
      kind: "contact",
      endpoint: "/api/contacts/rahul",
      section: "",
    });
    expect(previewTarget("/opportunities/google-swe#application")).toEqual({
      kind: "opportunity",
      endpoint: "/api/opportunities/google-swe",
      section: "#application",
    });
    expect(previewTarget("/companies/microsoft#company-contacts")?.kind).toBe(
      "company",
    );
    expect(previewTarget("/referrals/rahul-request")?.kind).toBe("referral");
  });

  it("reads an application from the list route that names one", () => {
    expect(previewTarget("/applications?preview=app-1#application")).toEqual({
      kind: "application",
      endpoint: "/api/applications/app-1",
      section: "#application",
    });
    expect(previewTarget("/applications")).toBeNull();
  });

  it("refuses anything that is not an in-product record path", () => {
    for (const href of [
      "/today",
      "/settings/queue?review=k",
      "//evil.invalid.test/contacts/rahul",
      "https://jobpilot.invalid.test/contacts/rahul",
      "javascript:alert(1)",
    ]) {
      expect(previewTarget(href), href).toBeNull();
    }
  });
});

describe("what a forced preview is allowed to cover", () => {
  // A popup over an internal route could only repeat the path the click already
  // states, so D-065's amendment limits a forced preview to a saved address.
  it("covers records whether or not the caller asks for it", () => {
    expect(previewable("/contacts/rahul", false)).toBe(true);
    expect(previewable("/contacts/rahul", true)).toBe(true);
  });

  it("covers an external address only when the caller asks for it", () => {
    expect(previewable("https://careers.microsoft.com", true)).toBe(true);
    expect(previewable("https://careers.microsoft.com", false)).toBe(false);
  });

  it("never covers an internal route that is not a record", () => {
    for (const href of ["/add", "/settings", "/compose", "/settings/documents"]) {
      expect(previewable(href, true), href).toBe(false);
    }
  });
});

describe("preview links", () => {
  it("marks a record link as opening a dialog without taking it out of the tab order", () => {
    const html = renderToStaticMarkup(
      <PreviewLink className="table-link" href="/contacts/rahul">
        Rahul Sharma
      </PreviewLink>,
    );
    expect(html).toContain('aria-haspopup="dialog"');
    // Until it can open the dialog it stays an ordinary, reachable link to the
    // record page: taking it out of the tab order to win a race would cost the
    // keyboard and the no-script reader the whole product.
    expect(html).toContain('data-preview-ready="false"');
    expect(html).toContain('href="/contacts/rahul"');
    expect(html).not.toContain("inert");
  });

  it("leaves an internal action button as an ordinary link", () => {
    const html = renderToStaticMarkup(
      <PreviewLink preview className="btn" href="/add">
        Add
      </PreviewLink>,
    );
    expect(html).not.toContain("aria-haspopup");
    expect(html).not.toContain("data-preview-ready");
    expect(html).toContain('href="/add"');
  });
});
