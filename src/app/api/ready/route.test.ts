import { describe, expect, it } from "vitest";

import { GET, dynamic, runtime } from "./route";

describe("GET /api/ready", () => {
  it("answers 200 with exactly { ok: true }", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("leaks nothing else — no version, environment, session or build stamp", async () => {
    const response = await GET();
    const body = await response.text();

    expect(body).toBe('{"ok":true}');
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("is dynamic and runs on Node, so systemd probes the live process", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
  });

  it("stays green while account mail is unavailable", async () => {
    expect((await GET()).status).toBe(200);
  });
});
