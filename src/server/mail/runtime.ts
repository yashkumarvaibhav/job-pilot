import type { SendQueueDependencies } from "../jobs/send-queue";
import type { InboxReadDependencies } from "../repos/inbox-content";
import { readGmailOAuthConfig } from "./google-config";
import { GoogleGmailMailPort } from "./google-send";
import { GoogleGmailReadPort } from "./google-read";
import type { InboxSyncDependencies } from "./inbox-sync";

export function getMailSendDependencies(
  environment: NodeJS.ProcessEnv = process.env,
): SendQueueDependencies | null {
  const config = readGmailOAuthConfig(environment);
  if (!config) return null;
  return {
    mailPort: new GoogleGmailMailPort({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    }),
    tokenKey: config.tokenKey,
  };
}

export function getMailReadDependencies(
  environment: NodeJS.ProcessEnv = process.env,
): (InboxReadDependencies & InboxSyncDependencies) | null {
  const config = readGmailOAuthConfig(environment);
  if (!config) return null;
  return {
    port: new GoogleGmailReadPort({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    }),
    tokenKey: config.tokenKey,
  };
}
