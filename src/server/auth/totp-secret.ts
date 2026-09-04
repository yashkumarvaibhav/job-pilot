import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

import { decodeTokenKey, TokenEncryptionError } from "../mail/token-crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AAD_PREFIX = "job-pilot:totp-secret:v1";

type SecretEnvelope = {
  version: 1;
  iv: string;
  ciphertext: string;
  tag: string;
};

function aad(userId: string): Buffer {
  return Buffer.from(`${AAD_PREFIX}:${userId}`, "utf8");
}

export function encryptTotpSecret(
  secret: string,
  encodedKey: string,
  userId: string,
): string {
  if (!secret) throw new TokenEncryptionError("A TOTP secret is required.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, decodeTokenKey(encodedKey), iv);
  cipher.setAAD(aad(userId));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const envelope: SecretEnvelope = {
    version: 1,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
  return JSON.stringify(envelope);
}

export function decryptTotpSecret(
  stored: string,
  encodedKey: string,
  userId: string,
): string {
  try {
    const envelope = JSON.parse(stored) as Partial<SecretEnvelope>;
    if (
      envelope.version !== 1 ||
      typeof envelope.iv !== "string" ||
      typeof envelope.ciphertext !== "string" ||
      typeof envelope.tag !== "string"
    ) {
      throw new Error("invalid envelope");
    }
    const iv = Buffer.from(envelope.iv, "base64");
    const tag = Buffer.from(envelope.tag, "base64");
    if (iv.length !== IV_BYTES || tag.length !== 16) {
      throw new Error("invalid envelope");
    }
    const decipher = createDecipheriv(ALGORITHM, decodeTokenKey(encodedKey), iv);
    decipher.setAAD(aad(userId));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new TokenEncryptionError(
      "The stored authenticator secret could not be decrypted.",
    );
  }
}
