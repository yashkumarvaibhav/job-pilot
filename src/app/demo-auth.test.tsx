import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalMode = process.env.JOB_PILOT_DEPLOYMENT_MODE;
const originalEmail = process.env.DEMO_ACCOUNT_EMAIL;

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import LoginPage from "./(auth)/login/page";
import SignupPage from "./(auth)/signup/page";
import { POST as signup } from "./api/auth/signup/route";

afterEach(() => {
  if (originalMode === undefined) delete process.env.JOB_PILOT_DEPLOYMENT_MODE;
  else process.env.JOB_PILOT_DEPLOYMENT_MODE = originalMode;
  if (originalEmail === undefined) delete process.env.DEMO_ACCOUNT_EMAIL;
  else process.env.DEMO_ACCOUNT_EMAIL = originalEmail;
});

describe("demo authentication surfaces", () => {
  it("shows the demo account on sign in without exposing its password", () => {
    process.env.JOB_PILOT_DEPLOYMENT_MODE = "demo";
    process.env.DEMO_ACCOUNT_EMAIL = "demo@jobpilot.invalid.test";

    const html = renderToStaticMarkup(<LoginPage />);

    expect(html).toContain("Demo environment");
    expect(html).toContain("demo@jobpilot.invalid.test");
    expect(html).not.toContain("Create account");
  });

  it("replaces the signup form with the closed-demo notice", () => {
    process.env.JOB_PILOT_DEPLOYMENT_MODE = "demo";

    const html = renderToStaticMarkup(<SignupPage />);

    expect(html).toContain("Public account creation is closed for this demo.");
    expect(html).toContain("Sign in");
    expect(html).not.toContain("Create your workspace");
  });

  it("rejects signup before reading or writing credentials", async () => {
    process.env.JOB_PILOT_DEPLOYMENT_MODE = "demo";

    const response = await signup(
      new Request("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "another@invalid.test",
          password: "synthetic-password",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Public account creation is closed for this demo.",
    });
  });
});
