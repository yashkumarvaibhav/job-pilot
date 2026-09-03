const REQUIRED_GMAIL_ENV = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "TOKEN_KEY",
] as const;

export type GmailOAuthAvailability = {
  configured: boolean;
  missing: string[];
};

export function readGmailOAuthAvailability(
  environment: NodeJS.ProcessEnv = process.env,
): GmailOAuthAvailability {
  const missing = REQUIRED_GMAIL_ENV.filter(
    (name) => !environment[name]?.trim(),
  );
  return { configured: missing.length === 0, missing: [...missing] };
}
