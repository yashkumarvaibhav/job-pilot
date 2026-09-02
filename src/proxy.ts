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
};

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

  const response = NextResponse.next();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export default proxy;
