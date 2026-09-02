export type AccountMailDelivery = {
  recipient: string;
  url: string;
  expiresAt: Date;
};

export interface AccountMailPort {
  sendVerification(delivery: AccountMailDelivery): Promise<void>;
  sendPasswordReset(delivery: AccountMailDelivery): Promise<void>;
}

export type CapturedAccountMail = AccountMailDelivery & {
  kind: "verify_email" | "reset_password";
};

/**
 * A deliberately in-memory fixture. It is injectable in tests and local owner
 * checks, never selected from an environment variable and never logs a bearer
 * link. JP-0019 owns the production adapter.
 */
export class MemoryAccountMailPort implements AccountMailPort {
  readonly deliveries: CapturedAccountMail[] = [];

  async sendVerification(delivery: AccountMailDelivery): Promise<void> {
    this.deliveries.push({ kind: "verify_email", ...delivery });
  }

  async sendPasswordReset(delivery: AccountMailDelivery): Promise<void> {
    this.deliveries.push({ kind: "reset_password", ...delivery });
  }
}

/** Fail closed until JP-0019 installs the owner-selected D-039 adapter. */
export function configuredAccountMailPort(): AccountMailPort | null {
  return null;
}
