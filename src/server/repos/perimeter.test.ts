import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { dueSourceKey } from "../../domain/due-source";
import { parseExportQuery } from "../../domain/export";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { listActivity } from "./activity";
import {
  applyToOpportunity,
  getApplication,
  listApplications,
  updateApplication,
} from "./applications";
import {
  createCompany,
  deleteCompany,
  findCompanyByName,
  getCompany,
  listCompanies,
  updateCompany,
} from "./companies";
import {
  ContactInputError,
  createContact,
  deleteContact,
  getContact,
  listContacts,
  updateContact,
} from "./contacts";
import {
  DocumentInputError,
  createDocument,
  deleteDocumentVersion,
  getDocument,
  getDocumentVersion,
  listDocuments,
  listVersionChoices,
  readDocumentVersionFile,
  storeDocumentVersion,
  versionDisplayNames,
  workspaceStoredBytes,
} from "./documents";
import { buildWorkspaceExport } from "./export";
import { getImportMapping, saveImportMapping } from "./import-mappings";
import {
  InteractionInputError,
  createInteraction,
  getInteraction,
  listInteractions,
  markInteractionReplied,
} from "./interactions";
import {
  createInterview,
  deleteInterview,
  getInterview,
  listInterviews,
  updateInterview,
} from "./interviews";
import {
  completeNotifications,
  dismissNotifications,
  listMutedNotificationKinds,
  listNotifications,
  materializeNotifications,
  muteNotificationKind,
  snoozeNotifications,
} from "./notifications";
import {
  OpportunityInputError,
  createOpportunity,
  createOpportunityFromConversation,
  getOpportunity,
  linkContactToOpportunity,
  listContactOpportunities,
  listOpportunities,
  listOpportunityContacts,
  updateOpportunity,
} from "./opportunities";
import {
  createReferral,
  getReferral,
  listReferrals,
  updateReferral,
} from "./referrals";
import {
  readWorkspaceSettings,
  updateWorkspaceSettings,
} from "./settings";
import {
  attachTag,
  deleteTag,
  detachTag,
  getTag,
  labelsForEntities,
  listEntityTags,
  listTags,
} from "./tags";
import {
  TaskInputError,
  completeTask,
  createTask,
  createTaskFromDerived,
  getTask,
  listDueItems,
  listTasks,
  updateTask,
} from "./tasks";
import { getTodaySnapshot } from "./today";

const TENANT_ROUTE_FILES = [
  "activity/route.ts",
  "applications/[id]/route.ts",
  "applications/route.ts",
  "companies/[id]/route.ts",
  "companies/route.ts",
  "contacts/[id]/interactions/[interactionId]/mark-replied/route.ts",
  "contacts/[id]/interactions/route.ts",
  "contacts/[id]/route.ts",
  "contacts/route.ts",
  "document-versions/[versionId]/file/route.ts",
  "document-versions/[versionId]/route.ts",
  "documents/[id]/versions/route.ts",
  "documents/route.ts",
  "export/route.ts",
  "import/route.ts",
  "interviews/[id]/route.ts",
  "interviews/route.ts",
  "notifications/dismiss/route.ts",
  "notifications/done/route.ts",
  "notifications/materialize/route.ts",
  "notifications/mute/route.ts",
  "notifications/route.ts",
  "notifications/snooze/route.ts",
  "opportunities/[id]/link-contact/route.ts",
  "opportunities/[id]/route.ts",
  "opportunities/from-conversation/route.ts",
  "opportunities/route.ts",
  "referrals/[id]/route.ts",
  "referrals/route.ts",
  "settings/route.ts",
  "tags/[id]/route.ts",
  "tags/detach/route.ts",
  "tags/route.ts",
  "tasks/[id]/complete/route.ts",
  "tasks/[id]/route.ts",
  "tasks/from-derived/route.ts",
  "tasks/route.ts",
  "today/route.ts",
] as const;

const NON_TENANT_ROUTE_FILES = [
  "auth/login/route.ts",
  "auth/logout/route.ts",
  "auth/signup/route.ts",
  "ready/route.ts",
] as const;

function routeFiles(directory: string, root = directory): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return routeFiles(path, root);
    }
    return entry.name === "route.ts" ? [relative(root, path)] : [];
  });
}

describe("registered tenant perimeter", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    const uploadsRoot = mkdtempSync(join(process.cwd(), "var/perimeter-test-"));
    cleanups.push(() => {
      fixture.dispose();
      rmSync(uploadsRoot, { force: true, recursive: true });
    });
    return { ...fixture, uploadsRoot };
  }

  function seedPrivateGraph(fixture: ReturnType<typeof newFixture>) {
    const database = fixture.client.db;
    const tenant = fixture.tenantB;
    const company = createCompany(database, tenant, {
      id: "private-company",
      name: "Private Boundary Company",
      notes: "private-company-marker",
      nextAction: "Private company action",
      nextActionDue: "2026-09-03",
    });
    const contact = createContact(database, tenant, {
      id: "private-contact",
      companyId: company.id,
      name: "Private Boundary Contact",
      notes: "private-contact-marker",
      nextAction: "Private contact action",
      followUpOn: "2026-09-03",
    });
    const interaction = createInteraction(database, tenant, {
      id: "private-interaction",
      contactId: contact.id,
      channel: "email",
      direction: "inbound",
      body: "private-interaction-marker",
      requiresReply: true,
    });
    const opportunity = createOpportunity(database, tenant, {
      id: "private-opportunity",
      companyId: company.id,
      role: "Private Boundary Role",
      notes: "private-opportunity-marker",
      nextAction: "Private opportunity action",
      nextActionDue: "2026-09-03",
      deadlineOn: "2026-09-04",
    });
    const application = applyToOpportunity(database, tenant, {
      id: "private-application",
      opportunityId: opportunity.id,
      portal: "Private portal",
      appliedOn: "2026-09-02",
    })!;
    const referral = createReferral(database, tenant, {
      id: "private-referral",
      contactId: contact.id,
      opportunityId: opportunity.id,
      channel: "email",
      nextAction: "Private referral action",
      followUpOn: "2026-09-03",
    })!;
    const task = createTask(database, tenant, {
      id: "private-task",
      title: "Private boundary task",
      dueOn: "2026-09-03",
      entityType: "contact",
      entityId: contact.id,
    });
    const interview = createInterview(database, tenant, {
      id: "private-interview",
      opportunityId: opportunity.id,
      kind: "Private round",
      dateOn: "2026-09-03",
      time: "10:00",
    })!;
    const tagged = attachTag(database, tenant, {
      id: "private-tag",
      label: "Private boundary tag",
      entityType: "company",
      entityId: company.id,
    })!;
    const document = createDocument(database, tenant, {
      id: "private-document",
      name: "Private boundary resume",
    });
    const version = storeDocumentVersion(
      database,
      tenant,
      {
        id: "private-version",
        documentId: document.id,
        label: "Private v1",
        bytes: new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10]),
        contentType: "application/pdf",
        originalFilename: "private.pdf",
      },
      fixture.uploadsRoot,
    );
    saveImportMapping(database, tenant, "companies", {
      name: "Private Company Column",
    });
    const notifications = materializeNotifications(database, tenant, {
      now: new Date("2026-09-02T02:00:00.000Z"),
    });

    return {
      company,
      contact,
      interaction,
      opportunity,
      application,
      referral,
      task,
      interview,
      tagId: tagged.tagId,
      document,
      version,
      notificationIds: notifications.ids,
    };
  }

  it("keeps the route inventory explicit as new API surfaces are registered", () => {
    const apiRoot = join(process.cwd(), "src/app/api");
    expect(routeFiles(apiRoot).sort()).toEqual(
      [...TENANT_ROUTE_FILES, ...NON_TENANT_ROUTE_FILES].sort(),
    );
  });

  it("treats every foreign id and nested link like a missing id without writing activity", () => {
    const fixture = newFixture();
    const privateRows = seedPrivateGraph(fixture);
    const database = fixture.client.db;
    const a = fixture.tenantA;
    const beforeEvents = fixture.rowCount("activity_event");

    expect(getCompany(database, a, privateRows.company.id)).toEqual(
      getCompany(database, a, "missing-company"),
    );
    expect(getContact(database, a, privateRows.contact.id)).toEqual(
      getContact(database, a, "missing-contact"),
    );
    expect(getInteraction(database, a, privateRows.interaction.id)).toEqual(
      getInteraction(database, a, "missing-interaction"),
    );
    expect(getOpportunity(database, a, privateRows.opportunity.id)).toEqual(
      getOpportunity(database, a, "missing-opportunity"),
    );
    expect(getApplication(database, a, privateRows.application.id)).toEqual(
      getApplication(database, a, "missing-application"),
    );
    expect(getReferral(database, a, privateRows.referral.id)).toEqual(
      getReferral(database, a, "missing-referral"),
    );
    expect(getTask(database, a, privateRows.task.id)).toEqual(
      getTask(database, a, "missing-task"),
    );
    expect(getInterview(database, a, privateRows.interview.id)).toEqual(
      getInterview(database, a, "missing-interview"),
    );
    expect(getTag(database, a, privateRows.tagId)).toEqual(
      getTag(database, a, "missing-tag"),
    );
    expect(getDocument(database, a, privateRows.document.id)).toEqual(
      getDocument(database, a, "missing-document"),
    );
    expect(getDocumentVersion(database, a, privateRows.version.id)).toEqual(
      getDocumentVersion(database, a, "missing-version"),
    );
    expect(
      readDocumentVersionFile(
        database,
        a,
        privateRows.version.id,
        fixture.uploadsRoot,
      ),
    ).toEqual(
      readDocumentVersionFile(
        database,
        a,
        "missing-version",
        fixture.uploadsRoot,
      ),
    );

    expect(updateCompany(database, a, privateRows.company.id, { notes: "x" })).toBeUndefined();
    expect(deleteCompany(database, a, privateRows.company.id)).toBe(false);
    expect(updateContact(database, a, privateRows.contact.id, { notes: "x" })).toBeUndefined();
    expect(deleteContact(database, a, privateRows.contact.id)).toBe(false);
    expect(markInteractionReplied(database, a, privateRows.interaction.id)).toBeUndefined();
    expect(updateOpportunity(database, a, privateRows.opportunity.id, { notes: "x" })).toBeUndefined();
    expect(updateApplication(database, a, privateRows.application.id, { notes: "x" })).toBeUndefined();
    expect(updateReferral(database, a, privateRows.referral.id, { notes: "x" })).toBeUndefined();
    expect(updateTask(database, a, privateRows.task.id, { title: "x" })).toBeUndefined();
    expect(completeTask(database, a, privateRows.task.id)).toBeUndefined();
    expect(updateInterview(database, a, privateRows.interview.id, { notes: "x" })).toBeUndefined();
    expect(deleteInterview(database, a, privateRows.interview.id)).toBe(false);
    expect(deleteTag(database, a, privateRows.tagId)).toBe(false);

    expect(() =>
      createContact(database, a, {
        name: "Cross boundary",
        companyId: privateRows.company.id,
      }),
    ).toThrowError(ContactInputError);
    expect(() =>
      createInteraction(database, a, {
        contactId: privateRows.contact.id,
        channel: "email",
        direction: "outbound",
      }),
    ).toThrowError(InteractionInputError);
    expect(() =>
      createOpportunity(database, a, {
        companyId: privateRows.company.id,
        role: "Cross boundary",
      }),
    ).toThrowError(OpportunityInputError);
    expect(
      createOpportunityFromConversation(database, a, {
        contactId: privateRows.contact.id,
        role: "Cross boundary",
      }),
    ).toBeUndefined();
    expect(
      linkContactToOpportunity(
        database,
        a,
        privateRows.opportunity.id,
        privateRows.contact.id,
      ),
    ).toBeUndefined();
    expect(listOpportunityContacts(database, a, privateRows.opportunity.id)).toEqual([]);
    expect(listContactOpportunities(database, a, privateRows.contact.id)).toEqual([]);
    expect(
      applyToOpportunity(database, a, {
        opportunityId: privateRows.opportunity.id,
        portal: "Cross boundary",
        appliedOn: "2026-09-02",
      }),
    ).toBeUndefined();
    expect(
      createReferral(database, a, {
        contactId: privateRows.contact.id,
        opportunityId: privateRows.opportunity.id,
        channel: "email",
      }),
    ).toBeUndefined();
    expect(() =>
      createTask(database, a, {
        title: "Cross boundary",
        entityType: "contact",
        entityId: privateRows.contact.id,
      }),
    ).toThrowError(TaskInputError);
    expect(
      createTaskFromDerived(database, a, {
        sourceKey: dueSourceKey("contact_next_action", privateRows.contact.id),
      }),
    ).toBeUndefined();
    expect(
      createInterview(database, a, {
        opportunityId: privateRows.opportunity.id,
        kind: "Cross boundary",
      }),
    ).toBeUndefined();
    expect(
      attachTag(database, a, {
        label: "Cross boundary",
        entityType: "company",
        entityId: privateRows.company.id,
      }),
    ).toBeUndefined();
    expect(
      detachTag(database, a, {
        tagId: privateRows.tagId,
        entityType: "company",
        entityId: privateRows.company.id,
      }),
    ).toBe(false);

    expect(
      snoozeNotifications(
        database,
        a,
        privateRows.notificationIds,
        new Date("2026-09-03T02:00:00.000Z"),
        new Date("2026-09-02T02:00:00.000Z"),
      ),
    ).toEqual([]);
    expect(dismissNotifications(database, a, privateRows.notificationIds)).toEqual([]);
    expect(completeNotifications(database, a, privateRows.notificationIds)).toEqual([]);
    expect(() =>
      deleteDocumentVersion(
        database,
        a,
        privateRows.version.id,
        fixture.uploadsRoot,
      ),
    ).toThrowError(DocumentInputError);

    expect(fixture.rowCount("activity_event")).toBe(beforeEvents);
    expect(getCompany(database, fixture.tenantB, privateRows.company.id)?.notes).toBe(
      "private-company-marker",
    );
    expect(getTask(database, fixture.tenantB, privateRows.task.id)?.status).toBe("open");
    expect(getDocumentVersion(database, fixture.tenantB, privateRows.version.id)).toBeDefined();
  });

  it("keeps collections, filters, aggregates, settings, and import mappings inside the session workspace", () => {
    const fixture = newFixture();
    const privateRows = seedPrivateGraph(fixture);
    const database = fixture.client.db;
    const a = fixture.tenantA;
    const now = new Date("2026-09-02T02:00:00.000Z");

    const visibleToA = {
      companies: listCompanies(database, a),
      contacts: listContacts(database, a),
      interactions: listInteractions(database, a),
      opportunities: listOpportunities(database, a),
      applications: listApplications(database, a),
      referrals: listReferrals(database, a, { asOfOn: "2026-09-02" }),
      tasks: listTasks(database, a),
      due: listDueItems(database, a),
      tags: listTags(database, a),
      entityTags: listEntityTags(database, a, "company", privateRows.company.id),
      labels: [...labelsForEntities(database, a, "company", [privateRows.company.id])],
      notifications: listNotifications(database, a, "all", { now }),
      interviews: listInterviews(database, a),
      filteredInterviews: listInterviews(database, a, privateRows.opportunity.id),
      documents: listDocuments(database, a),
      versionChoices: listVersionChoices(database, a),
      versionNames: [...versionDisplayNames(database, a)],
      activity: listActivity(database, a, { timeZone: "UTC" }),
      filteredActivity: listActivity(database, a, {
        timeZone: "UTC",
        entityType: "company",
        entityId: privateRows.company.id,
      }),
      today: getTodaySnapshot(database, a, { now }),
      importMapping: getImportMapping(database, a, "companies"),
      storedBytes: workspaceStoredBytes(database, a),
      exportJson: buildWorkspaceExport(
        database,
        a,
        parseExportQuery(new URLSearchParams("format=json&set=all")),
      ).body,
    };

    expect(JSON.stringify(visibleToA)).not.toContain("Private Boundary");
    expect(JSON.stringify(visibleToA)).not.toContain("private-");
    expect(findCompanyByName(database, a, privateRows.company.name)).toBeUndefined();
    expect(visibleToA.companies).toEqual([]);
    expect(visibleToA.notifications).toEqual([]);
    expect(visibleToA.documents).toEqual([]);
    expect(visibleToA.activity).toEqual([
      expect.objectContaining({
        kind: "ACCOUNT_FOUNDATION_CREATED",
        entityId: a.workspaceId,
      }),
    ]);
    expect(visibleToA.today.stats).toEqual({
      deadlines: 0,
      followUps: 0,
      interviewsToday: 0,
      needReply: 0,
    });
    expect(visibleToA.importMapping).toEqual({});
    expect(visibleToA.storedBytes).toBe(0);

    updateWorkspaceSettings(database, a, {
      displayName: "Tenant A Updated",
      timezone: "Europe/London",
    });
    saveImportMapping(database, a, "companies", { name: "A Company Column" });
    muteNotificationKind(database, a, "company_next_action");

    expect(readWorkspaceSettings(database, a)).toMatchObject({
      displayName: "Tenant A Updated",
      timezone: "Europe/London",
    });
    expect(readWorkspaceSettings(database, fixture.tenantB)).toMatchObject({
      displayName: "Tenant B",
      timezone: "America/New_York",
    });
    expect(getImportMapping(database, a, "companies")).toEqual({
      name: "A Company Column",
    });
    expect(getImportMapping(database, fixture.tenantB, "companies")).toEqual({
      name: "Private Company Column",
    });
    expect(listMutedNotificationKinds(database, a)).toEqual([
      "company_next_action",
    ]);
    expect(listMutedNotificationKinds(database, fixture.tenantB)).toEqual([]);
  });

  it("interleaves due-row materialization with each workspace's timezone and preferences", () => {
    const fixture = newFixture();
    const database = fixture.client.db;
    const now = new Date("2026-09-02T02:00:00.000Z");

    createCompany(database, fixture.tenantA, {
      id: "due-company-a",
      name: "Visible A",
      nextAction: "A only",
      nextActionDue: "2026-09-03",
    });
    createCompany(database, fixture.tenantB, {
      id: "due-company-b",
      name: "Private B",
      nextAction: "B only",
      nextActionDue: "2026-09-03",
    });

    const firstB = materializeNotifications(database, fixture.tenantB, { now });
    const firstA = materializeNotifications(database, fixture.tenantA, { now });
    const secondB = materializeNotifications(database, fixture.tenantB, { now });
    const secondA = materializeNotifications(database, fixture.tenantA, { now });

    expect(secondA.ids).toEqual(firstA.ids);
    expect(secondB.ids).toEqual(firstB.ids);
    expect(new Set([...firstA.ids, ...firstB.ids]).size).toBe(2);

    const rowsA = listNotifications(database, fixture.tenantA, "all", { now });
    const rowsB = listNotifications(database, fixture.tenantB, "all", { now });
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
    expect(rowsA[0]).toMatchObject({
      entityId: "due-company-a",
      body: "A only",
      dueKey: dueSourceKey("company_next_action", "due-company-a"),
    });
    expect(rowsB[0]).toMatchObject({
      entityId: "due-company-b",
      body: "B only",
      dueKey: dueSourceKey("company_next_action", "due-company-b"),
    });
    expect(rowsA[0]!.dueAt).not.toEqual(rowsB[0]!.dueAt);

    muteNotificationKind(database, fixture.tenantA, "company_next_action");
    expect(listNotifications(database, fixture.tenantA, "muted", { now })).toHaveLength(1);
    expect(listNotifications(database, fixture.tenantB, "muted", { now })).toEqual([]);
    expect(listNotifications(database, fixture.tenantB, "unread", { now })).toHaveLength(1);
  });
});
