import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { currentTenantMock, enrollmentTenantMock, redirectMock } = vi.hoisted(() => ({
  currentTenantMock: vi.fn(),
  enrollmentTenantMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/server/auth/current-session", () => ({
  currentTenant: currentTenantMock,
  currentIncompleteSignupTenant: enrollmentTenantMock,
}));

vi.mock("@/server/demo-mode", () => ({
  isDemoMode: () => false,
}));

vi.mock("@/server/auth/account-secret-key", () => ({
  configuredAccountSecretKey: () => "synthetic-test-key",
}));

vi.mock("@/server/auth/account-security", () => ({
  readAccountSecurity: () => ({
    setup: {
      secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
      uri: "otpauth://totp/Job%20Pilot%3Aowner_name?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Job+Pilot",
    },
  }),
}));

vi.mock("@/server/db/runtime", () => ({ getDatabase: () => ({}) }));

import ForgotPasswordPage from "./(auth)/forgot-password/page";
import LoginPage from "./(auth)/login/page";
import SignupPage from "./(auth)/signup/page";
import LandingPage from "./page";

describe("public account-access routing", () => {
  beforeEach(() => {
    redirectMock.mockReset();
    currentTenantMock.mockReset().mockResolvedValue(null);
    enrollmentTenantMock.mockReset().mockResolvedValue(null);
  });

  it("renders the public root without loading a workspace", async () => {
    const html = renderToStaticMarkup(
      await LandingPage({ searchParams: Promise.resolve({}) }),
    );

    expect(redirectMock).not.toHaveBeenCalled();
    expect(html).toContain("Run your job search from one clear workspace");
    expect(html).toContain("Create account");
    expect(html).toContain("Sign in");
  });

  it("sends a completed session from the public root to Today", async () => {
    currentTenantMock.mockResolvedValue({ userId: "user-a", workspaceId: "workspace-a" });

    await LandingPage({ searchParams: Promise.resolve({}) });

    expect(redirectMock).toHaveBeenCalledWith("/today");
  });

  it("keeps an incomplete signup on the forced setup dialog", async () => {
    enrollmentTenantMock.mockResolvedValue({ userId: "user-a", workspaceId: "workspace-a" });

    const html = renderToStaticMarkup(
      await LandingPage({ searchParams: Promise.resolve({ auth: "sign-in" }) }),
    );

    expect(html).toContain('data-auth-mode="setup-totp"');
    expect(html).toContain("Authenticator setup QR code");
  });

  it("redirects legacy account pages to canonical landing dialog states", () => {
    LoginPage();
    SignupPage();
    ForgotPasswordPage();

    expect(redirectMock.mock.calls).toEqual([
      ["/?auth=sign-in"],
      ["/?auth=sign-up"],
      ["/?auth=forgot-password"],
    ]);
  });
});
