import { NextResponse } from "next/server";

import { UNCERTAIN_DELIVERY_ERROR } from "@/domain/send-safety";
import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { flushSendQueue } from "@/server/jobs/send-queue";
import { getMailSendDependencies } from "@/server/mail/runtime";
import { listVersionChoices } from "@/server/repos/documents";
import {
  jsonObject,
  sequenceErrorStatus,
  sequenceOverrideRejected,
  sequenceReviewJson,
} from "@/server/repos/sequence-http";
import {
  SequenceError,
  getSequenceReview,
  saveSequenceReview,
  sequenceQueueRowId,
  stopEnrollment,
} from "@/server/repos/sequences";
import {
  SendSafetyError,
  approveQueueMessage,
  getQueueMessage,
  listQueueSummaries,
  setQueueMessageState,
} from "@/server/repos/send-safety";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const database = getDatabase();
  const id = (await context.params).id;
  const review = getSequenceReview(database, tenant, id);
  if (review) {
    return NextResponse.json(sequenceReviewJson(review));
  }
  const row = getQueueMessage(database, tenant, id);
  const summary = row
    ? listQueueSummaries(database, tenant).find((item) => item.id === row.id)
    : undefined;
  const attachments = row
    ? listVersionChoices(database, tenant)
        .filter((version) => row.attachmentVersionIdsJson.includes(version.id))
        .map((version) => ({ id: version.id, name: version.displayName }))
    : [];
  return row && summary
    ? NextResponse.json({
        id: row.id,
        accountEmail: summary.accountEmail,
        contactName: summary.contactName,
        origin: row.origin,
        status: row.status,
        recipient: row.recipient,
        subject: row.subject,
        body: row.body,
        attachments,
        sendAt: row.sendAt,
        sentAt: row.sentAt,
        lastError: row.lastError,
        deliveryUncertain: row.lastError === UNCERTAIN_DELIVERY_ERROR,
        sendAnywayAvailable: row.origin !== "sequence",
      })
    : NextResponse.json({ error: "Queue row not found." }, { status: 404 });
}

export async function PATCH(request: Request, context: Context) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = null;
  }
  const input = jsonObject(raw);
  if (
    !input ||
    !("action" in input) ||
    ("uncertainDeliveryAcknowledged" in input &&
      typeof input.uncertainDeliveryAcknowledged !== "boolean") ||
    ("uncertainDeliveryAcknowledged" in input && input.action !== "send_now") ||
    (input.action !== "hold" &&
      input.action !== "cancel" &&
      input.action !== "send_now")
  ) {
    return NextResponse.json(
      { error: "Choose send now, hold or cancel for one queue row." },
      { status: 400 },
    );
  }
  const database = getDatabase();
  const id = (await context.params).id;
  const review = getSequenceReview(database, tenant, id);
  const queued = getQueueMessage(database, tenant, id);
  const sequenceTarget = review ?? (queued?.origin === "sequence" ? queued : null);
  if (sequenceTarget) {
    const rejected = sequenceOverrideRejected(Object.keys(input));
    if (rejected) {
      return NextResponse.json({ error: rejected.message }, { status: 409 });
    }
  } else if (
    Object.keys(input).some(
      (key) => key !== "action" && key !== "uncertainDeliveryAcknowledged",
    )
  ) {
    return NextResponse.json(
      { error: "Choose send now, hold or cancel for one queue row." },
      { status: 400 },
    );
  }
  try {
    if (review && input.action === "cancel") {
      const stopped = stopEnrollment(database, tenant, review.enrollmentId);
      return stopped
        ? NextResponse.json(stopped)
        : NextResponse.json({ error: "Queue row not found." }, { status: 404 });
    }
    if (review && input.action === "send_now") {
      const dependencies = getMailSendDependencies();
      if (!dependencies) {
        return NextResponse.json(
          { error: "Gmail sending is not configured yet." },
          { status: 503 },
        );
      }
      const now = new Date();
      const saved = saveSequenceReview(database, tenant, id, {
        sendAt: now,
        approve: true,
        requestKeys: Object.keys(input),
        now,
      });
      if (!saved) {
        return NextResponse.json({ error: "Queue row not found." }, { status: 404 });
      }
      await flushSendQueue(database, dependencies, {
        now,
        maxSends: 1,
        onlyQueueId: sequenceQueueRowId(review.enrollmentId, review.stepId),
      });
      return NextResponse.json(
        getQueueMessage(
          database,
          tenant,
          sequenceQueueRowId(review.enrollmentId, review.stepId),
        ),
      );
    }
    let row;
    if (input.action === "send_now") {
      const dependencies = getMailSendDependencies();
      if (!dependencies) {
        return NextResponse.json(
          { error: "Gmail sending is not configured yet." },
          { status: 503 },
        );
      }
      const now = new Date();
      row = approveQueueMessage(database, tenant, id, {
        sendAt: now,
        now,
        uncertainDeliveryAcknowledged:
          "uncertainDeliveryAcknowledged" in input &&
          input.uncertainDeliveryAcknowledged === true,
      });
      if (row) {
        await flushSendQueue(database, dependencies, {
          now,
          maxSends: 1,
          onlyQueueId: id,
        });
        row = getQueueMessage(database, tenant, id);
      }
    } else {
      row = setQueueMessageState(
        database,
        tenant,
        id,
        input.action as "hold" | "cancel",
        new Date(),
      );
    }
    return row
      ? NextResponse.json(row)
      : NextResponse.json({ error: "Queue row not found." }, { status: 404 });
  } catch (error) {
    if (error instanceof SequenceError) {
      return NextResponse.json(
        { error: error.message },
        { status: sequenceErrorStatus(error) },
      );
    }
    if (error instanceof SendSafetyError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
