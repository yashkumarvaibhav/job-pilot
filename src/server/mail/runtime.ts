import { readGmailOAuthConfig } from "./google-config";
import { GoogleGmailMailPort } from "./google-send";
import type { ComposeSendDependencies } from "./compose-service";

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
