import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness for systemd and, later, the tunnel smoke test.
 *
 * It answers `{ ok: true }` and nothing else on purpose: no version, no build
 * stamp, no environment, no session. It also touches no database — a readiness
 * probe that opened one would fail on first boot, before any schema exists,
 * which is precisely when an operator most needs the process to say it is up.
 */
export async function GET() {
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
