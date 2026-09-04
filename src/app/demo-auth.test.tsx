import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalMode = process.env.JOB_PILOT_DEPLOYMENT_MODE;
const originalEmail = process.env.DEMO_ACCOUNT_EMAIL;

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn() }),
  headers: async () => ({ get: () => null }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { LandingExperience } from "@/components/landing-experience";
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

    const html = renderToStaticMarkup(
      <LandingExperience
        authMode="sign-in"
        demoAccount="demo@jobpilot.invalid.test"
        setupAvailable
        signupAvailable={false}
        totpSetup={null}
      />,
    );

    expect(html).toContain("Demo environment");
    expect(html).toContain("demo@jobpilot.invalid.test");
    expect(html).not.toContain("Create your workspace");
  });

  it("replaces the signup form with the closed-demo notice", () => {
    process.env.JOB_PILOT_DEPLOYMENT_MODE = "demo";

    const html = renderToStaticMarkup(
      <LandingExperience
        authMode="sign-up"
        demoAccount="demo@jobpilot.invalid.test"
        setupAvailable
        signupAvailable={false}
        totpSetup={null}
      />,
    );

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
          username: "another_owner",
          password: "synthetic-password",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Public account creation is closed for this demo.",
    });
  });

  it("renders ordinary account access in public application mode", () => {
    process.env.JOB_PILOT_DEPLOYMENT_MODE = "public";

    const loginHtml = renderToStaticMarkup(
      <LandingExperience
        authMode="sign-in"
        demoAccount={null}
        setupAvailable
        signupAvailable
        totpSetup={null}
      />,
    );
    const signupHtml = renderToStaticMarkup(
      <LandingExperience
        authMode="sign-up"
        demoAccount={null}
        setupAvailable
        signupAvailable
        totpSetup={null}
      />,
    );

    expect(loginHtml).toContain("Open the private workspace that belongs only to your account.");
    expect(loginHtml).toContain("No account yet?");
    expect(loginHtml).toContain("Create account");
    expect(loginHtml).toContain("Forgot password?");
    expect(loginHtml).not.toContain("Demo environment");

    expect(signupHtml).toContain("Create account");
    expect(signupHtml).toContain("Username");
    expect(signupHtml).toContain("Password");
    expect(signupHtml).toContain("Confirm password");
    expect(signupHtml).not.toContain('type="email"');
    expect(signupHtml).not.toContain("Public account creation is closed");
  });
});
