import { readGmailOAuthConfig } from "./google-config";
import { GoogleGmailMailPort } from "./google-send";
import type { ComposeSendDependencies } from "./compose-service";
import { GoogleGmailReadPort } from "./google-read";
import type { InboxReadDependencies } from "../repos/inbox-content";
import type { InboxSyncDependencies } from "./inbox-sync";

export function getMailSendDependencies(
  environment: NodeJS.ProcessEnv = process.env,
): ComposeSendDependencies | null {
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
