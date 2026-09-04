import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hashPassword } from "../../src/server/auth/password";
import { startTotpEnrollment } from "../../src/server/auth/account-security";
import { openDatabase } from "../../src/server/db/client";
import { createAccountFoundation } from "../../src/server/db/foundation";
import { migrateDatabase } from "../../src/server/db/migrate";
import { applyToOpportunity } from "../../src/server/repos/applications";
import { createAssessment } from "../../src/server/repos/assessments";
import { createCompany } from "../../src/server/repos/companies";
import { createContact } from "../../src/server/repos/contacts";
import {
  createDocument,
  storeDocumentVersion,
} from "../../src/server/repos/documents";
import { createInteraction } from "../../src/server/repos/interactions";
import { createInterview } from "../../src/server/repos/interviews";
import { materializeNotifications } from "../../src/server/repos/notifications";
import { createOpportunity } from "../../src/server/repos/opportunities";
import { createReferral } from "../../src/server/repos/referrals";
import { createTask } from "../../src/server/repos/tasks";
import { ACCOUNT_PASSWORD, BASE_URL, FIXTURE } from "./fixture";

const NOW = new Date("2026-09-02T09:00:00.000Z");
const TODAY = "2026-09-02";

async function portIsOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitUntilReady(child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Responsive server exited with ${child.exitCode}.`);
    }
    try {
      const response = await fetch(`${BASE_URL}/api/ready`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Responsive server did not become ready.");
}

function seedWorkspace(
  database: ReturnType<typeof openDatabase>["db"],
  uploadsRoot: string,
  tenant: ReturnType<typeof createAccountFoundation>["tenant"],
  ids: (typeof FIXTURE)["a"] | (typeof FIXTURE)["b"],
  label: "Atlas" | "Private",
) {
  const company = createCompany(database, tenant, {
    id: ids.companyId,
    name: `${label} Labs`,
    industry: "Developer tools",
    target: true,
    nextAction: "Review open roles",
    nextActionDue: TODAY,
    now: NOW,
  });
  const contact = createContact(database, tenant, {
    id: ids.contactId,
    companyId: company.id,
    name: `${label} Person`,
    relationship: "alumni",
    networkingStatus: "checking_for_openings",
    nextAction: "Follow up",
    followUpOn: TODAY,
    methods: [
      {
        id: `${ids.contactId}-email`,
        kind: "email",
        value: `${label.toLowerCase()}@contacts.invalid.test`,
        isPrimary: true,
      },
    ],
    now: NOW,
  });
  const opportunity = createOpportunity(database, tenant, {
    id: ids.opportunityId,
    companyId: company.id,
    role: `${label} Platform Engineer`,
    jobId: `${label.toUpperCase()}-101`,
    location: "Bengaluru",
    workMode: "Hybrid",
    deadlineOn: "2026-09-10",
    priority: "High",
    stage: "finding_referral",
    nextAction: "Ask for a referral",
    nextActionDue: TODAY,
    now: NOW,
  });
  createInteraction(database, tenant, {
    id: `${ids.contactId}-interaction`,
    contactId: contact.id,
    opportunityId: opportunity.id,
    channel: "whatsapp",
    direction: "outbound",
    body: `Synthetic ${label.toLowerCase()} conversation.`,
    now: NOW,
  });
  createReferral(database, tenant, {
    id: ids.referralId,
    contactId: contact.id,
    opportunityId: opportunity.id,
    requestedOn: TODAY,
    channel: "whatsapp",
    stage: "requested",
    followUpOn: TODAY,
    nextAction: "Wait for reply",
    todayOn: TODAY,
    now: NOW,
  });
  createDocument(database, tenant, {
    id: ids.documentId,
    name: `${label} Resume`,
    kind: "resume",
    now: NOW,
  });
  const version = storeDocumentVersion(
    database,
    tenant,
    {
      id: ids.versionId,
      documentId: ids.documentId,
      label: "v1",
      bytes: new TextEncoder().encode("%PDF-1.4 synthetic responsive fixture"),
      contentType: "application/pdf",
      now: NOW,
    },
    uploadsRoot,
  );
  applyToOpportunity(database, tenant, {
    id: `${ids.opportunityId}-application`,
    opportunityId: opportunity.id,
    portal: "Careers",
    appliedOn: TODAY,
    resumeVersionId: version.id,
    now: NOW,
  });
  createTask(database, tenant, {
    id: `${ids.opportunityId}-task`,
    title: `Prepare for ${label}`,
    dueOn: TODAY,
    priority: "high",
    entityType: "opportunity",
    entityId: opportunity.id,
    now: NOW,
  });
  createInterview(database, tenant, {
    id: `${ids.opportunityId}-interview`,
    opportunityId: opportunity.id,
    kind: "Technical",
    roundIndex: 1,
    at: "2026-09-02T14:00:00.000Z",
    interviewer: `${label} Interviewer`,
    now: NOW,
  });
  createAssessment(database, tenant, {
    id: `${ids.opportunityId}-assessment`,
    opportunityId: opportunity.id,
    kind: "Online assessment",
    platform: "Synthetic platform",
    dueAt: "2026-09-03T14:00:00.000Z",
    now: NOW,
  });
  materializeNotifications(database, tenant, { now: NOW });
}

export default async function globalSetup() {
  if (await portIsOpen(3061)) {
    throw new Error("Port 3061 is already in use; refusing to replace its process.");
  }

  const root = mkdtempSync(join(tmpdir(), "job-pilot-responsive-"));
  const databasePath = join(root, "job-pilot.sqlite");
  const uploadsRoot = join(root, "uploads");
  mkdirSync(uploadsRoot, { recursive: true });
  migrateDatabase(databasePath);

  const client = openDatabase(databasePath);
  try {
    const passwordHash = await hashPassword(ACCOUNT_PASSWORD);
    const tenantA = createAccountFoundation(client.db, {
      ids: {
        userId: FIXTURE.accountA.userId,
        workspaceId: FIXTURE.accountA.workspaceId,
      },
      usernameNormalized: FIXTURE.accountA.username,
      passwordHash,
      displayName: "Responsive A",
      now: NOW,
    }).tenant;
    const tenantB = createAccountFoundation(client.db, {
      ids: {
        userId: FIXTURE.accountB.userId,
        workspaceId: FIXTURE.accountB.workspaceId,
      },
      usernameNormalized: FIXTURE.accountB.username,
      passwordHash,
      displayName: "Responsive B",
      now: NOW,
    }).tenant;
    createAccountFoundation(client.db, {
      ids: {
        userId: FIXTURE.accountEmpty.userId,
        workspaceId: FIXTURE.accountEmpty.workspaceId,
      },
      usernameNormalized: FIXTURE.accountEmpty.username,
      passwordHash,
      displayName: "Responsive Empty",
      now: NOW,
    });
    const setupTenant = createAccountFoundation(client.db, {
      ids: {
        userId: FIXTURE.accountSetup.userId,
        workspaceId: FIXTURE.accountSetup.workspaceId,
      },
      usernameNormalized: FIXTURE.accountSetup.username,
      passwordHash,
      displayName: "Responsive Setup",
      signupCompletedAt: null,
      now: NOW,
    }).tenant;
    startTotpEnrollment(client.db, setupTenant, {
      tokenKey: Buffer.alloc(32, 21).toString("base64"),
      secretBytes: Buffer.from("12345678901234567890", "ascii"),
      now: NOW,
    });
    seedWorkspace(client.db, uploadsRoot, tenantA, FIXTURE.a, "Atlas");
    seedWorkspace(client.db, uploadsRoot, tenantB, FIXTURE.b, "Private");
  } finally {
    client.close();
  }

  const child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", "3061"],
    {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        DATABASE_PATH: databasePath,
        UPLOADS_ROOT: uploadsRoot,
        JOB_PILOT_DEPLOYMENT_MODE: "public",
        TOKEN_KEY: Buffer.alloc(32, 21).toString("base64"),
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: "ignore",
    },
  );
  await waitUntilReady(child);

  return async () => {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
          throw error;
        }
      }
    }
    rmSync(root, { force: true, recursive: true });
  };
}
