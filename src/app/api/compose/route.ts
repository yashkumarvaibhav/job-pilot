import { NextResponse } from "next/server";

import { lastSyncedCopy } from "@/domain/sequence";
import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { flushSendQueue } from "@/server/jobs/send-queue";
import { syncInboxAccount } from "@/server/mail/inbox-sync";
import { getMailReadDependencies, getMailSendDependencies } from "@/server/mail/runtime";
import { listEmailAccounts } from "@/server/repos/email-accounts";
import {
  evaluateComposeOutreach,
  logOutreachWarningOverride,
} from "@/server/repos/outreach-warning";
import {
  SendSafetyError,
  createQueueMessage,
  getQueueMessage,
  parseWorkspaceSendAt,
  tonightQueueTime,
  tomorrowMorningQueueTime,
} from "@/server/repos/send-safety";

export const runtime = "nodejs";

type ComposeApproval =
  | "send_now"
  | "send_tonight"
  | "send_tomorrow"
  | "custom_time";

type ComposeQueueInput = {
  accountId: string;
  contactId: string;
  opportunityId?: string | null;
  referralId?: string | null;
  subject: string;
  body: string;
  attachmentVersionIds: string[];
  approval: ComposeApproval;
  sendAt?: string;
  sendAnyway?: boolean;
  acknowledgeOutreachWarning?: boolean;
};

const ALLOWED_KEYS = new Set([
  "accountId",
  "contactId",
  "opportunityId",
  "referralId",
  "subject",
  "body",
  "attachmentVersionIds",
  "approval",
  "sendAt",
  "sendAnyway",
  "acknowledgeOutreachWarning",
]);
const APPROVALS = new Set<ComposeApproval>([
  "send_now",
  "send_tonight",
  "send_tomorrow",
  "custom_time",
]);

async function readInput(request: Request): Promise<ComposeQueueInput | null> {
  try {
    const value: unknown = await request.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some((key) => !ALLOWED_KEYS.has(key))) return null;
    if (
      typeof input.accountId !== "string" ||
      typeof input.contactId !== "string" ||
      typeof input.subject !== "string" ||
      typeof input.body !== "string" ||
      typeof input.approval !== "string" ||
      !APPROVALS.has(input.approval as ComposeApproval) ||
      (input.opportunityId !== undefined &&
        input.opportunityId !== null &&
        typeof input.opportunityId !== "string") ||
      (input.referralId !== undefined &&
        input.referralId !== null &&
        typeof input.referralId !== "string") ||
      (input.sendAt !== undefined && typeof input.sendAt !== "string") ||
      (input.sendAnyway !== undefined && typeof input.sendAnyway !== "boolean") ||
      (input.acknowledgeOutreachWarning !== undefined &&
        typeof input.acknowledgeOutreachWarning !== "boolean") ||
      !Array.isArray(input.attachmentVersionIds) ||
      input.attachmentVersionIds.some((id) => typeof id !== "string")
    ) {
      return null;
    }
    if (input.approval === "custom_time" && typeof input.sendAt !== "string") {
      return null;
    }
    if (input.approval !== "custom_time" && input.sendAt !== undefined) return null;
    return input as ComposeQueueInput;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }
  const input = await readInput(request);
  if (!input) {
    return NextResponse.json(
      { error: "Review one valid email and one send time before approving." },
      { status: 400 },
    );
  }
  const database = getDatabase();
  const now = new Date();
  const dependencies = getMailSendDependencies();
  if (input.approval === "send_now" && !dependencies) {
    return NextResponse.json(
      { error: "Gmail sending is not configured yet." },
      { status: 503 },
    );
  }
  const read = getMailReadDependencies();
  if (read) {
    try {
      await syncInboxAccount(database, tenant, input.accountId, {
        ...read,
        now: () => now,
      });
    } catch {
      if (input.sendAnyway !== true) {
        const account = listEmailAccounts(database, tenant).find(
          (row) => row.id === input.accountId,
        );
        return NextResponse.json(
          {
            error: lastSyncedCopy(account?.lastSyncAt ?? null, now),
            lastSyncedAt: account?.lastSyncAt?.toISOString() ?? null,
            sendAnywayRequired: true,
          },
          { status: 409 },
        );
      }
    }
  }
  try {
    const sendAt =
      input.approval === "send_now"
        ? now
        : input.approval === "send_tomorrow"
          ? tomorrowMorningQueueTime(database, tenant, input.accountId, now)
          : input.approval === "send_tonight"
            ? tonightQueueTime(database, tenant, input.accountId, now)
            : parseWorkspaceSendAt(database, tenant, input.sendAt!);
    if (Number.isNaN(sendAt.valueOf())) {
      return NextResponse.json(
        { error: "Custom send time must be a valid instant." },
        { status: 400 },
      );
    }
    const outreach = evaluateComposeOutreach(database, tenant, {
      contactId: input.contactId,
      opportunityId: input.opportunityId,
      now,
    });
    if (outreach.kind === "blocked") {
      return NextResponse.json({ error: outreach.message }, { status: 409 });
    }
    if (outreach.kind === "warning" && input.acknowledgeOutreachWarning !== true) {
      return NextResponse.json(
        {
          error: outreach.copy,
          acknowledgeOutreachWarningRequired: true,
          outreachWarnings: outreach.warnings,
        },
        { status: 409 },
      );
    }
    if (outreach.kind === "warning") {
      logOutreachWarningOverride(database, tenant, {
        contactId: input.contactId,
        opportunityId: input.opportunityId,
        kinds: outreach.warnings.map((warning) => warning.kind),
        now,
      });
    }
    const queued = createQueueMessage(database, tenant, {
      accountId: input.accountId,
      contactId: input.contactId,
      opportunityId: input.opportunityId,
      referralId: input.referralId,
      origin: "one_off",
      subject: input.subject,
      body: input.body,
      attachmentVersionIds: input.attachmentVersionIds,
      sendAt,
      approvalKind: "owner_click",
      now,
    });
    if (input.approval === "send_now" && dependencies) {
      await flushSendQueue(database, dependencies, {
        now,
        maxSends: 1,
        onlyQueueId: queued.id,
      });
    }
    const result = getQueueMessage(database, tenant, queued.id)!;
    return NextResponse.json(
      {
        id: result.id,
        accountId: result.accountId,
        contactId: result.contactId,
        status: result.status,
        sendAt: result.sendAt,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SendSafetyError) {
      const status = error.message.endsWith("not found.") ? 404 : 409;
      return NextResponse.json({ error: error.message }, { status });
    }
    throw error;
  }
}
