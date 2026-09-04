import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, type DatabaseClient } from "../server/db/client";
import { createAccountFoundation } from "../server/db/foundation";
import { migrateDatabase } from "../server/db/migrate";
import type { TenantContext } from "../server/db/tenant";

type FoundationTable =
  | "user_account"
  | "workspace"
  | "settings"
  | "auth_session"
  | "account_token"
  | "activity_event"
  | "email_account"
  | "email_template"
  | "email_thread"
  | "email_message"
  | "gmail_recovery_generation"
  | "gmail_recovery_thread"
  | "send_queue"
  | "suppression_entry"
  | "company"
  | "contact"
  | "contact_method"
  | "interaction"
  | "import_mapping"
  | "opportunity"
  | "opportunity_contact"
  | "application"
  | "referral_request"
  | "task"
  | "tag"
  | "entity_tag"
  | "notification"
  | "interview"
  | "assessment"
  | "document"
  | "document_version"
  | "document_usage"
  | "saved_search"
  | "automation_rule"
  | "automation_execution";

export type BaseTenantTestFixture = {
  client: DatabaseClient;
  databasePath: string;
  rowCount: (table: FoundationTable) => number;
  dispose: () => void;
};

export type SeededTenantTestFixture = BaseTenantTestFixture & {
  tenantA: TenantContext;
  tenantB: TenantContext;
};

export function createTenantTestFixture(options: {
  seedTenants: false;
}): BaseTenantTestFixture;
export function createTenantTestFixture(options?: {
  seedTenants?: true;
}): SeededTenantTestFixture;
export function createTenantTestFixture(
  options: { seedTenants?: boolean } = {},
): BaseTenantTestFixture | SeededTenantTestFixture {
  const directory = mkdtempSync(join(tmpdir(), "job-pilot-tenant-"));
  const databasePath = join(directory, "test.sqlite");
  let client: DatabaseClient;
  let disposed = false;

  try {
    migrateDatabase(databasePath);
    client = openDatabase(databasePath);
  } catch (error) {
    rmSync(directory, { force: true, recursive: true });
    throw error;
  }

  const base: BaseTenantTestFixture = {
    client,
    databasePath,
    rowCount: (table) => {
      const row = client.sqlite
        .prepare(`select count(*) as count from ${table}`)
        .get() as { count: number };
      return row.count;
    },
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      client.close();
      rmSync(directory, { force: true, recursive: true });
    },
  };

  if (options.seedTenants === false) {
    return base;
  }

  const tenantA = createAccountFoundation(client.db, {
    usernameNormalized: "tenant-a",
    passwordHash: "synthetic-password-hash-a",
    displayName: "Tenant A",
    timezone: "Asia/Kolkata",
    ids: { userId: "user-a", workspaceId: "workspace-a" },
    now: new Date("2026-08-31T10:00:00.000Z"),
  }).tenant;
  const tenantB = createAccountFoundation(client.db, {
    usernameNormalized: "tenant-b",
    passwordHash: "synthetic-password-hash-b",
    displayName: "Tenant B",
    timezone: "America/New_York",
    ids: { userId: "user-b", workspaceId: "workspace-b" },
    now: new Date("2026-08-31T11:00:00.000Z"),
  }).tenant;

  return { ...base, tenantA, tenantB };
}
