import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import ForgotPasswordPage from "./(auth)/forgot-password/page";
import ResetPasswordPage from "./(auth)/reset-password/page";
import VerifyPage from "./(auth)/verify/page";

describe("account lifecycle screens", () => {
  it("names the unavailable platform-mail boundary without hiding sign in", () => {
    const html = renderToStaticMarkup(<ForgotPasswordPage />);

    expect(html).toContain("Reset password");
    expect(html).toContain("Account email is temporarily unavailable");
    expect(html).toContain("Sign in");
    expect(html).not.toContain("Send reset link");
  });

  it("renders verification confirmation without putting the bearer token in HTML", async () => {
    const token = "fixture-verification-bearer";
    const html = renderToStaticMarkup(
      await VerifyPage({ searchParams: Promise.resolve({ token }) }),
    );

    expect(html).toContain("Verify email");
    expect(html).toContain("Confirm this single-use link");
    expect(html).not.toContain(token);
  });

  it("renders reset fields without putting the bearer token in HTML", async () => {
    const token = "fixture-reset-bearer";
    const html = renderToStaticMarkup(
      await ResetPasswordPage({ searchParams: Promise.resolve({ token }) }),
    );

    expect(html).toContain("Choose a new password");
    expect(html).toContain("New password");
    expect(html).toContain("Confirm new password");
    expect(html).toContain("signs every existing session out");
    expect(html).not.toContain(token);
  });

  it("shows a missing-token state instead of a reset form", async () => {
    const html = renderToStaticMarkup(
      await ResetPasswordPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("missing its token");
    expect(html).not.toContain("Confirm new password");
  });
});
