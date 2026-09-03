import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const AAD_PREFIX = "job-pilot:gmail-refresh-token:v1";
const IV_BYTES = 12;

type TokenEnvelope = {
  version: 1;
  iv: string;
  ciphertext: string;
  tag: string;
};

export class TokenEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenEncryptionError";
  }
}

function decodeKey(encodedKey: string): Buffer {
  const normalized = encodedKey.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new TokenEncryptionError(
      "TOKEN_KEY must be a base64-encoded 32-byte key.",
    );
  }
  const key = Buffer.from(normalized, "base64");
  if (key.length !== 32) {
    throw new TokenEncryptionError(
      "TOKEN_KEY must be a base64-encoded 32-byte key.",
    );
  }
  return key;
}

function additionalData(context: string): Buffer {
  return Buffer.from(`${AAD_PREFIX}:${context}`, "utf8");
}

export function encryptRefreshToken(
  refreshToken: string,
  encodedKey: string,
  context = "",
): string {
  const key = decodeKey(encodedKey);
  if (refreshToken.length === 0) {
    throw new TokenEncryptionError("A refresh token is required.");
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(additionalData(context));
  const ciphertext = Buffer.concat([
    cipher.update(refreshToken, "utf8"),
    cipher.final(),
  ]);
  const envelope: TokenEnvelope = {
    version: 1,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
  return JSON.stringify(envelope);
}

export function decryptRefreshToken(
  stored: string,
  encodedKey: string,
  context = "",
): string {
  const key = decodeKey(encodedKey);

  try {
    const envelope = JSON.parse(stored) as Partial<TokenEnvelope>;
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
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(additionalData(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new TokenEncryptionError(
      "The stored Gmail credential could not be decrypted.",
    );
  }
}
