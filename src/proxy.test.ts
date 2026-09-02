import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { CROSS_SITE_REFUSED } from "./lib/request-origin";
import { proxy } from "./proxy";

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
});
