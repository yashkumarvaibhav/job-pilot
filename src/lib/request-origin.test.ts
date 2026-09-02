import { describe, expect, it } from "vitest";

import {
  CROSS_SITE_REFUSED,
  isMutatingMethod,
  isCrossSiteRequest,
} from "./request-origin";

const SELF = "jobpilot.yashkumarvaibhav.me";

describe("request origin policy", () => {
  it("knows which methods can change anything", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
      expect(isMutatingMethod(method)).toBe(false);
    }
    for (const method of ["POST", "PATCH", "PUT", "DELETE", "post"]) {
      expect(isMutatingMethod(method)).toBe(true);
    }
  });

  it("refuses a browser request another site initiated", () => {
    expect(
      isCrossSiteRequest({
        secFetchSite: "cross-site",
        origin: "https://evil.invalid.test",
        host: SELF,
        proto: "https",
      }),
    ).toBe(true);
  });

  it("allows the app's own pages and its own subdomains", () => {
    for (const site of ["same-origin", "same-site"]) {
      expect(
        isCrossSiteRequest({
          secFetchSite: site,
          origin: `https://${SELF}`,
          host: SELF,
          proto: "https",
        }),
      ).toBe(false);
    }
  });

  it("allows a request with no initiator at all", () => {
    // Sec-Fetch-Site: none is a typed URL or a bookmark — never an attacker page.
    expect(
      isCrossSiteRequest({
        secFetchSite: "none",
        origin: null,
        host: SELF,
        proto: "https",
      }),
    ).toBe(false);
  });

  it("falls back to Origin when the browser sent no Sec-Fetch-Site", () => {
    expect(
      isCrossSiteRequest({
        secFetchSite: null,
        origin: "https://evil.invalid.test",
        host: SELF,
        proto: "https",
      }),
    ).toBe(true);
    expect(
      isCrossSiteRequest({
        secFetchSite: null,
        origin: `https://${SELF}`,
        host: SELF,
        proto: "https",
      }),
    ).toBe(false);
  });

  it("matches the port and the scheme, not just the hostname", () => {
    expect(
      isCrossSiteRequest({
        secFetchSite: null,
        origin: "http://127.0.0.1:8061",
        host: "127.0.0.1:8061",
        proto: "http",
      }),
    ).toBe(false);
    expect(
      isCrossSiteRequest({
        secFetchSite: null,
        origin: "http://127.0.0.1:9999",
        host: "127.0.0.1:8061",
        proto: "http",
      }),
    ).toBe(true);
    // A page served over http cannot post to the https origin of the same host.
    expect(
      isCrossSiteRequest({
        secFetchSite: null,
        origin: `http://${SELF}`,
        host: SELF,
        proto: "https",
      }),
    ).toBe(true);
  });

  it("lets a non-browser client through, since CSRF needs a browser", () => {
    // curl, the deploy checks and the route tests send neither header. A browser
    // always sends at least one on a POST, so this is not a bypass for the attack
    // this check exists to stop.
    expect(
      isCrossSiteRequest({
        secFetchSite: null,
        origin: null,
        host: SELF,
        proto: "https",
      }),
    ).toBe(false);
  });

  it("refuses rather than guesses when it cannot tell who it is", () => {
    expect(
      isCrossSiteRequest({
        secFetchSite: null,
        origin: "https://evil.invalid.test",
        host: null,
        proto: "https",
      }),
    ).toBe(true);
  });

  it("has copy that does not coach an attacker", () => {
    expect(CROSS_SITE_REFUSED.length).toBeGreaterThan(0);
    expect(CROSS_SITE_REFUSED).not.toMatch(/origin|header|sec-fetch/i);
  });
});
