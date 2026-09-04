import { decodeTokenKey } from "../mail/token-crypto";

export function configuredAccountSecretKey(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const candidate = environment.TOKEN_KEY?.trim();
  if (!candidate) return null;
  try {
    decodeTokenKey(candidate);
    return candidate;
  } catch {
    return null;
  }
}
