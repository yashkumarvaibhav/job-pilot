import { NextResponse, type NextRequest } from "next/server";

import {
  CROSS_SITE_REFUSED,
  isCrossSiteRequest,
  isMutatingMethod,
} from "@/lib/request-origin";

/**
 * The first code on every request (§62, D-022). Deliberately thin: it decides
 * with the pure policy in `src/lib/request-origin.ts` and sets headers. It must
 * not hash a password or open the database — Next.js runs this ahead of routing
 * on every request, including static assets.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  /**
   * Everything this app serves is one person's private workspace. There is no
   * page worth caching in a shared proxy, so rather than deciding per response
   * — which would mean reading the session here — nothing is cacheable at all.
   */
  "cache-control": "no-store, private",
};

/**
 * Every asset this app loads is its own: fonts are self-hosted woff2 and the
 * brand kit forbids a Google Fonts import, so nothing here needs a third-party
 * source. `'strict-dynamic'` lets the framework's own nonce-carrying loader pull
 * the chunks it needs without listing them.
 *
 * React uses `eval` in development for readable stack traces and does not in
 * production, so `'unsafe-eval'` is scoped to dev only and never shipped.
 */
export function contentSecurityPolicy(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      isDev ? " 'unsafe-eval'" : ""
    }`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  if (
    isMutatingMethod(request.method) &&
    isCrossSiteRequest({
      secFetchSite: request.headers.get("sec-fetch-site"),
      origin: request.headers.get("origin"),
      host: request.headers.get("host"),
      proto: request.headers.get("x-forwarded-proto"),
    })
  ) {
    return NextResponse.json({ error: CROSS_SITE_REFUSED }, { status: 403 });
  }

  // Unpredictable and per-request: a reused nonce is no better than none.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
  );

  // The request copy is how `headers()` hands the nonce to the root layout's
  // pre-paint theme script; the response copy is what the browser enforces.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  response.headers.set("content-security-policy", policy);
  return response;
}

export default proxy;
