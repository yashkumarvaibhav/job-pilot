import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDatabase } from "../db/runtime";
import { emailAccount } from "../db/schema";
import { GoogleGmailMailPort } from "./google-send";
import { readGmailOAuthConfig } from "./google-config";
import { decryptRefreshToken } from "./token-crypto";

const RUN_VALUE = "I_APPROVE_ONE_SELF_ADDRESSED_MESSAGE";
const enabled = process.env.JOB_PILOT_MESSAGE_ID_INTEGRATION === RUN_VALUE;

describe.skipIf(!enabled)("connected Gmail Message-ID preservation", () => {
  it("sends one self-addressed message, finds it exactly, and opens the sequence gate", async () => {
    const accountId = process.env.JOB_PILOT_MESSAGE_ID_ACCOUNT_ID?.trim();
    if (!accountId) throw new Error("JOB_PILOT_MESSAGE_ID_ACCOUNT_ID is required.");
    const config = readGmailOAuthConfig();
    if (!config) throw new Error("Gmail configuration is required.");
    const database = getDatabase();
    const account = database
      .select()
      .from(emailAccount)
      .where(and(eq(emailAccount.id, accountId), eq(emailAccount.status, "connected")))
      .get();
    if (!account) throw new Error("Connected Gmail account not found.");
    const refreshToken = decryptRefreshToken(
      account.tokenBlob,
      config.tokenKey,
      `${account.workspaceId}:${account.id}`,
    );
    const domain = account.email.split("@")[1];
    const rfcMessageId = `<jp-integration-${randomUUID()}@${domain}>`;
    const port = new GoogleGmailMailPort({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });
    const receipt = await port.send({
      accountId: account.id,
      refreshToken,
      fromEmail: account.email,
      senderName: account.senderName,
      replyTo: account.replyTo,
      to: [account.email],
      subject: "Job Pilot Message-ID verification",
      body: "One owner-approved self-addressed verification message.",
      attachments: [],
      rfcMessageId,
    });
    const lookup = await port.findByRfcMessageId({ refreshToken, rfcMessageId });
    expect(receipt.rfcMessageId).toBe(rfcMessageId);
    expect(lookup).toMatchObject({
      status: "found",
      gmailMessageId: receipt.gmailMessageId,
    });
    database
      .update(emailAccount)
      .set({ messageIdVerifiedAt: new Date() })
      .where(
        and(
          eq(emailAccount.workspaceId, account.workspaceId),
          eq(emailAccount.id, account.id),
        ),
      )
      .run();
  });
});
