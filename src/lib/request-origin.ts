/**
 * Cross-site request policy (§62). `SameSite=Lax` on the session cookie already
 * stops a cross-site POST carrying it; this is the second lock, so a future
 * cookie change or a browser quirk cannot silently open the door.
 *
 * Pure on purpose: `src/proxy.ts` runs before everything else on every request,
 * and the decision it makes should be readable and testable on its own.
 */

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const CROSS_SITE_REFUSED =
  "This request did not come from Job Pilot. Reload the page and try again.";

export function isMutatingMethod(method: string): boolean {
  return MUTATING_METHODS.has(method.toUpperCase());
}

export type OriginFacts = {
  secFetchSite: string | null;
  origin: string | null;
  host: string | null;
  proto: string | null;
};

/**
 * `true` means refuse. The order matters: `Sec-Fetch-Site` is set by the browser
 * itself and cannot be forged by page script, so it is believed first. `Origin`
 * is the fallback for anything that did not send it.
 */
export function isCrossSiteRequest(facts: OriginFacts): boolean {
  const site = facts.secFetchSite?.trim().toLowerCase();
  if (site) {
    return site === "cross-site";
  }

  if (!facts.origin) {
    // No initiator information at all: not a browser, so not a CSRF vector.
    // Every browser sends Sec-Fetch-Site, and Origin on any mutating fetch.
    return false;
  }

  const expected = selfOrigin(facts);
  return expected === null || facts.origin.trim().toLowerCase() !== expected;
}

function selfOrigin(facts: OriginFacts): string | null {
  const host = facts.host?.trim().toLowerCase();
  if (!host) {
    return null;
  }
  const proto = facts.proto?.split(",")[0]?.trim().toLowerCase();
  const scheme = proto === "http" || proto === "https" ? proto : "https";
  return `${scheme}://${host}`;
}
