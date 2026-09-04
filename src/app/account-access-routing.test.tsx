import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { currentTenantMock, enrollmentTenantMock, redirectMock } = vi.hoisted(() => ({
  currentTenantMock: vi.fn(),
  enrollmentTenantMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@/server/auth/current-session", () => ({
  currentTenant: currentTenantMock,
  currentIncompleteSignupTenant: enrollmentTenantMock,
}));

vi.mock("@/server/demo-mode", () => ({
  isDemoMode: () => false,
}));

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

    expect(html).toContain('data-initial-auth="setup-totp"');
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
