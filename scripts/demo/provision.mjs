#!/usr/bin/env node
import { randomBytes, scryptSync } from "node:crypto";
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { assertDemoEnvironment } from "./config.mjs";

const IDS = {
  user: "demo-user",
  workspace: "demo-workspace",
  companyOne: "demo-company-atlas-labs",
  companyTwo: "demo-company-northstar",
  contactOne: "demo-contact-rahul-sharma",
  contactTwo: "demo-contact-ananya-mehta",
  opportunityOne: "demo-opportunity-platform-engineer",
  opportunityTwo: "demo-opportunity-software-engineer",
};

function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: 16_384, r: 8, p: 1 });
  return [
    "scrypt",
    16_384,
    8,
    1,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

function removeDemoState(configuration) {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${configuration.databasePath}${suffix}`, { force: true });
  }
  rmSync(configuration.uploadsRoot, { force: true, recursive: true });
}

function insertSyntheticData(database, configuration) {
  const now = Date.parse("2026-09-01T09:00:00.000Z");
  const insertEvent = database.prepare(
    `insert into activity_event
      (id, workspace_id, at, kind, entity_type, entity_id, payload_json)
     values (?, ?, ?, ?, ?, ?, '{}')`,
  );

  database.transaction(() => {
    database.prepare(
      `insert into user_account
        (id, email_normalized, password_hash, status, created_at, updated_at)
       values (?, ?, ?, 'active', ?, ?)`,
    ).run(IDS.user, configuration.accountEmail, hashPassword(configuration.accountPassword), now, now);
    database.prepare(
      "insert into workspace (id, owner_user_id, created_at) values (?, ?, ?)",
    ).run(IDS.workspace, IDS.user, now);
    database.prepare(
      `insert into settings
        (workspace_id, display_name, university, timezone, scoring_weights_json)
       values (?, ?, ?, ?, '{}')`,
    ).run(IDS.workspace, "Demo Candidate", "Synthetic University", "Asia/Kolkata");
    insertEvent.run("demo-event-account", IDS.workspace, now, "ACCOUNT_FOUNDATION_CREATED", "workspace", IDS.workspace);

    const insertCompany = database.prepare(
      `insert into company
        (id, workspace_id, name, website, careers_url, industry, type, locations, target, notes, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertCompany.run(
      IDS.companyOne,
      IDS.workspace,
      "Atlas Labs",
      "https://atlas.example.invalid",
      "https://atlas.example.invalid/careers",
      "Developer tools",
      "Product",
      "Bengaluru · Hybrid",
      1,
      "Synthetic target company for exploring the demo.",
      now,
    );
    insertCompany.run(
      IDS.companyTwo,
      IDS.workspace,
      "Northstar Systems",
      "https://northstar.example.invalid",
      "https://northstar.example.invalid/jobs",
      "Cloud infrastructure",
      "Product",
      "Remote · India",
      1,
      "Synthetic company; no real organization or contact details.",
      now,
    );

    const insertContact = database.prepare(
      `insert into contact
        (id, workspace_id, company_id, name, designation, relationship, source, location, notes,
         tags_json, preferred_contact_channel, networking_status, last_interaction_at, next_action,
         follow_up_on, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertContact.run(
      IDS.contactOne,
      IDS.workspace,
      IDS.companyOne,
      "Rahul Sharma",
      "Senior Platform Engineer",
      "alumni",
      "Synthetic alumni directory",
      "Bengaluru",
      "Demo-only contact at a non-deliverable address.",
      '["Alumni","Platform"]',
      "email",
      "checking_for_openings",
      Date.parse("2026-08-29T12:00:00.000Z"),
      "Follow up about platform roles",
      "2026-09-03",
      now,
    );
    insertContact.run(
      IDS.contactTwo,
      IDS.workspace,
      IDS.companyTwo,
      "Ananya Mehta",
      "Technical Recruiter",
      "recruiter",
      "Synthetic networking event",
      "Remote",
      "Demo-only contact; not a real person.",
      '["Recruiting"]',
      "linkedin",
      "waiting_for_reply",
      Date.parse("2026-08-31T15:30:00.000Z"),
      "Wait for role details",
      "2026-09-05",
      now,
    );

    const insertMethod = database.prepare(
      `insert into contact_method
        (id, workspace_id, contact_id, kind, value, value_normalized, is_primary, created_at)
       values (?, ?, ?, ?, ?, ?, 1, ?)`,
    );
    insertMethod.run(
      "demo-method-rahul-email",
      IDS.workspace,
      IDS.contactOne,
      "email",
      "rahul@contacts.invalid.test",
      "rahul@contacts.invalid.test",
      now,
    );
    insertMethod.run(
      "demo-method-ananya-linkedin",
      IDS.workspace,
      IDS.contactTwo,
      "linkedin",
      "https://linkedin.example.invalid/in/ananya-demo",
      "https://linkedin.example.invalid/in/ananya-demo",
      now,
    );

    const insertOpportunity = database.prepare(
      `insert into opportunity
        (id, workspace_id, company_id, role, job_id, url, location, work_mode, employment_type,
         experience_requirement, source, discovered_on, posted_on, deadline_on, compensation,
         priority, interest_score, eligibility, referral_preferred, jd_snapshot, notes, tags_json,
         bucket, stage, next_action, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertOpportunity.run(
      IDS.opportunityOne,
      IDS.workspace,
      IDS.companyOne,
      "Platform Engineer",
      "ATLAS-DEMO-101",
      "https://atlas.example.invalid/jobs/platform-engineer",
      "Bengaluru",
      "Hybrid",
      "Full-time",
      "0–2 years",
      "Synthetic careers page",
      "2026-08-28",
      "2026-08-27",
      "2026-09-15",
      "Demo compensation",
      "High",
      86,
      "Eligible",
      1,
      "Synthetic job description for demo exploration.",
      "Prepare a targeted resume before requesting the referral.",
      '["Platform","TypeScript"]',
      "active",
      "finding_referral",
      "Ask Rahul for role context",
      now,
    );
    insertOpportunity.run(
      IDS.opportunityTwo,
      IDS.workspace,
      IDS.companyTwo,
      "Software Engineer",
      "NORTH-DEMO-204",
      "https://northstar.example.invalid/jobs/software-engineer",
      "Remote · India",
      "Remote",
      "Full-time",
      "Graduate role",
      "Synthetic referral",
      "2026-08-31",
      "2026-08-30",
      "2026-09-20",
      "Demo compensation",
      "Medium",
      74,
      "Eligible",
      0,
      "Synthetic job description with no connection to a real employer.",
      "Review the role and decide whether to pursue it.",
      '["Backend","Graduate"]',
      "saved",
      "saved",
      "Review requirements",
      now,
    );

    database.prepare(
      `insert into interaction
        (id, workspace_id, contact_id, company_id, opportunity_id, channel, direction, occurred_at,
         body, requires_reply, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(
      "demo-interaction-rahul",
      IDS.workspace,
      IDS.contactOne,
      IDS.companyOne,
      IDS.opportunityOne,
      "email",
      "outbound",
      Date.parse("2026-08-29T12:00:00.000Z"),
      "Synthetic note: asked about the team and application timeline.",
      now,
    );

    for (const [id, kind, entityType, entityId] of [
      ["demo-event-company-one", "COMPANY_CREATED", "company", IDS.companyOne],
      ["demo-event-company-two", "COMPANY_CREATED", "company", IDS.companyTwo],
      ["demo-event-contact-one", "CONTACT_CREATED", "contact", IDS.contactOne],
      ["demo-event-contact-two", "CONTACT_CREATED", "contact", IDS.contactTwo],
      ["demo-event-opportunity-one", "OPPORTUNITY_CREATED", "opportunity", IDS.opportunityOne],
      ["demo-event-opportunity-two", "OPPORTUNITY_CREATED", "opportunity", IDS.opportunityTwo],
    ]) {
      insertEvent.run(id, IDS.workspace, now, kind, entityType, entityId);
    }
  })();
}

export function provisionDemo({
  appRoot = process.cwd(),
  env = process.env,
  migrationsFolder = resolve(process.cwd(), "drizzle"),
  reset = false,
} = {}) {
  if (!reset) throw new Error("Demo provisioning requires the explicit --reset flag.");
  const configuration = assertDemoEnvironment({ appRoot, env });
  removeDemoState(configuration);
  mkdirSync(configuration.uploadsRoot, { recursive: true });
  mkdirSync(configuration.backupsRoot, { recursive: true });
  mkdirSync(configuration.demoRoot, { recursive: true });
  for (const directory of [
    configuration.demoRoot,
    configuration.uploadsRoot,
    configuration.backupsRoot,
  ]) {
    chmodSync(directory, 0o700);
  }

  const sqlite = new Database(configuration.databasePath);
  try {
    sqlite.pragma("foreign_keys = ON");
    migrate(drizzle(sqlite), { migrationsFolder });
    insertSyntheticData(sqlite, configuration);
    const integrity = sqlite.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error(`Demo database integrity check failed: ${integrity}`);
  } finally {
    sqlite.close();
  }
  chmodSync(configuration.databasePath, 0o600);

  return {
    databasePath: configuration.databasePath,
    accountEmail: configuration.accountEmail,
    companies: 2,
    contacts: 2,
    opportunities: 2,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = provisionDemo({ reset: process.argv.slice(2).includes("--reset") });
    console.log(
      `demo provisioned for ${result.accountEmail}: ${result.companies} companies, ${result.contacts} contacts, ${result.opportunities} opportunities`,
    );
  } catch (error) {
    console.error(`demo provisioning refused: ${error.message}`);
    process.exitCode = 1;
  }
}
