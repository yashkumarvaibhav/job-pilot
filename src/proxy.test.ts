import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { CROSS_SITE_REFUSED } from "./lib/request-origin";
import { contentSecurityPolicy, proxy } from "./proxy";

const SELF = "jobpilot.yashkumarvaibhav.me";

function request(
  method: string,
  headers: Record<string, string> = {},
  path = "/api/contacts",
) {
  return new NextRequest(`https://${SELF}${path}`, {
    method,
    headers: { host: SELF, ...headers },
  });
}

describe("proxy", () => {
  it("refuses a mutating request another site initiated", () => {
    const response = proxy(
      request("POST", {
        "sec-fetch-site": "cross-site",
        origin: "https://evil.invalid.test",
      }),
    );

    expect(response.status).toBe(403);
  });

  it("says so in copy that does not explain the check", async () => {
    const response = proxy(
      request("DELETE", { "sec-fetch-site": "cross-site" }),
    );

    expect(await response.json()).toEqual({ error: CROSS_SITE_REFUSED });
  });

  it("lets the app's own pages mutate", () => {
    for (const site of ["same-origin", "same-site", "none"]) {
      const response = proxy(
        request("POST", {
          "sec-fetch-site": site,
          origin: `https://${SELF}`,
        }),
      );
      expect(response.status, site).toBe(200);
    }
  });

  it("never blocks a read, even one another site initiated", () => {
    // A cross-site GET is an ordinary link. Refusing it would break navigation
    // without preventing anything: CSRF is about state change.
    const response = proxy(
      request("GET", { "sec-fetch-site": "cross-site" }, "/"),
    );

    expect(response.status).toBe(200);
  });

  it("sets the security headers that need no per-request value", () => {
    const response = proxy(request("GET", {}, "/"));

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
  });

  it("lets no intermediary cache anything it serves", () => {
    for (const path of ["/", "/settings", "/api/today"]) {
      const response = proxy(request("GET", {}, path));
      expect(response.headers.get("cache-control"), path).toContain("no-store");
    }
  });

  it("issues a fresh unpredictable nonce on every request", () => {
    const first = proxy(request("GET", {}, "/"));
    const second = proxy(request("GET", {}, "/"));

    const nonceOf = (response: Response) =>
      /'nonce-([^']+)'/.exec(
        response.headers.get("content-security-policy") ?? "",
      )?.[1];

    const a = nonceOf(first);
    const b = nonceOf(second);
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
    expect((a as string).length).toBeGreaterThan(20);
  });

  it("puts the same nonce on the request so the layout can read it", () => {
    const response = proxy(request("GET", {}, "/"));

    const fromResponse = /'nonce-([^']+)'/.exec(
      response.headers.get("content-security-policy") ?? "",
    )?.[1];
    // NextResponse exposes the rewritten request headers it will forward.
    const forwarded = response.headers.get("x-middleware-override-headers");
    expect(forwarded).toContain("x-nonce");
    expect(
      response.headers.get("x-middleware-request-x-nonce"),
    ).toBe(fromResponse);
  });

  it("never ships unsafe-inline, and scopes unsafe-eval to development", () => {
    const production = contentSecurityPolicy("abc123", false);

    expect(production).not.toContain("unsafe-inline");
    expect(production).not.toContain("unsafe-eval");
    expect(production).toContain("'nonce-abc123'");
    expect(production).toContain("'strict-dynamic'");
    expect(production).toContain("frame-ancestors 'none'");
    expect(production).toContain("object-src 'none'");
    expect(production).toContain("base-uri 'self'");

    // React needs eval for readable stacks in dev only.
    expect(contentSecurityPolicy("abc123", true)).toContain("unsafe-eval");
  });

  it("allows no third-party source, because the app self-hosts everything", () => {
    const policy = contentSecurityPolicy("abc123", false);

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("font-src 'self'");
    expect(policy).not.toMatch(/https?:\/\//);
  });
});
