import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import ForgotPasswordPage from "./(auth)/forgot-password/page";

describe("account lifecycle screens", () => {
  it("uses username and an authenticator code for password recovery", () => {
    const html = renderToStaticMarkup(<ForgotPasswordPage />);

    expect(html).toContain("Reset password");
    expect(html).toContain("Username");
    expect(html).toContain("Authenticator code");
    expect(html).toContain("New password");
    expect(html).toContain("Confirm new password");
    expect(html).toContain("Sign in");
    expect(html).not.toContain("Email");
    expect(html).not.toContain("reset link");
  });

  it("states that recovery is unavailable without the configured authenticator", () => {
    const html = renderToStaticMarkup(<ForgotPasswordPage />);
    expect(html).toContain(
      "Without that authenticator, this account cannot be recovered.",
    );
  });
});
