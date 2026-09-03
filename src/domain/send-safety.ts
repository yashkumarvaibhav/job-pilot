import { createHash } from "node:crypto";

export type SendPayload = Readonly<{
  recipient: string;
  accountId: string;
  subject: string;
  body: string;
  attachmentVersionIds: readonly string[];
  sendAt: Date;
}>;

export function canonicalSendPayload(payload: SendPayload): string {
  if (!(payload.sendAt instanceof Date) || Number.isNaN(payload.sendAt.valueOf())) {
    throw new TypeError("Send time must be a valid instant.");
  }
  return JSON.stringify({
    version: 1,
    recipient: payload.recipient.trim().toLowerCase(),
    accountId: payload.accountId.trim(),
    subject: payload.subject,
    body: payload.body,
    attachmentVersionIds: [...payload.attachmentVersionIds],
    sendAt: payload.sendAt.toISOString(),
  });
}

export function hashSendPayload(payload: SendPayload): string {
  return createHash("sha256")
    .update(canonicalSendPayload(payload), "utf8")
    .digest("hex");
}

export function queueMessageId(queueId: string, senderEmail: string): string {
  const id = queueId.trim();
  const domain = senderEmail.trim().toLowerCase().split("@")[1];
  if (!id || /[<>@\s]/.test(id) || !domain || /[<>\s]/.test(domain)) {
    throw new TypeError("Queue row and sender must form a valid Message-ID.");
  }
  return `<jp-${id}@${domain}>`;
}
