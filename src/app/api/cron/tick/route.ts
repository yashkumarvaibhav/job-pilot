import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { getDatabase } from "@/server/db/runtime";
import { flushSendQueue } from "@/server/jobs/send-queue";
import { getMailSendDependencies } from "@/server/mail/runtime";

export const runtime = "nodejs";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function authorised(request: Request, secret: string | undefined): boolean {
  if (!secret || secret.length < 16) return false;
  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  return timingSafeEqual(digest(header.slice(prefix.length)), digest(secret));
}

export async function POST(request: Request) {
  if (!authorised(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const dependencies = getMailSendDependencies();
  if (!dependencies) {
    return NextResponse.json(
      { error: "Mail delivery is not configured." },
      { status: 503 },
    );
  }
  const result = await flushSendQueue(getDatabase(), dependencies);
  return NextResponse.json({ ok: true, ...result });
}
