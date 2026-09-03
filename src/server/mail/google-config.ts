const REQUIRED_GMAIL_ENV = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "TOKEN_KEY",
] as const;

export type GmailOAuthAvailability = {
  configured: boolean;
  missing: string[];
};

export type GmailOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenKey: string;
};

export function readGmailOAuthAvailability(
  environment: NodeJS.ProcessEnv = process.env,
): GmailOAuthAvailability {
  const missing = REQUIRED_GMAIL_ENV.filter(
    (name) => !environment[name]?.trim(),
  );
  return { configured: missing.length === 0, missing: [...missing] };
}

export function readGmailOAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GmailOAuthConfig | null {
  if (!readGmailOAuthAvailability(environment).configured) {
    return null;
  }
  return {
    clientId: environment.GOOGLE_CLIENT_ID!.trim(),
    clientSecret: environment.GOOGLE_CLIENT_SECRET!.trim(),
    redirectUri: environment.GOOGLE_REDIRECT_URI!.trim(),
    tokenKey: environment.TOKEN_KEY!.trim(),
  };
}
