import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantTestFixture } from "../../../../test/tenant-fixture";
import type { MailPort } from "../../../../server/mail/mail-port";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  dependencies: null as unknown,
}));

vi.mock("@/server/db/runtime", () => ({
  getDatabase: () => mocks.database,
}));
vi.mock("@/server/mail/runtime", () => ({
  getMailSendDependencies: () => mocks.dependencies,
  getMailReadDependencies: () => null,
}));

import { POST } from "./route";

function request(token?: string) {
  return new Request("https://jobpilot.invalid.test/api/cron/tick", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

describe("cron tick route", () => {
  const fixtures: { dispose: () => void }[] = [];
  const previousSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    mocks.database = fixture.client.db;
    process.env.CRON_SECRET = "synthetic-cron-secret";
    const mailPort: MailPort = {
      send: vi.fn(),
    };
    mocks.dependencies = { mailPort, tokenKey: Buffer.alloc(32, 3).toString("base64") };
  });

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  });

  it("returns 401 without the exact bearer", async () => {
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request("wrong"))).status).toBe(401);
  });

  it("is cheap while idle and makes no Gmail call", async () => {
    const response = await POST(request("synthetic-cron-secret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      reconciled: 0,
      sent: 0,
      deferred: 0,
    });
    const port = (mocks.dependencies as { mailPort: MailPort }).mailPort;
    expect(port.send).not.toHaveBeenCalled();
  });
});
