import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { LandingExperience } from "@/components/landing-experience";

function renderRecovery() {
  return renderToStaticMarkup(
    <LandingExperience
      authMode="forgot-password"
      demoAccount={null}
      setupAvailable
      signupAvailable
      totpSetup={null}
    />,
  );
}

describe("account lifecycle dialogs", () => {
  it("uses username and an authenticator code for password recovery", () => {
    const html = renderRecovery();

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Reset password");
    expect(html).toContain("Username");
    expect(html).toContain("Authenticator code");
    expect(html).toContain("New password");
    expect(html).toContain("Confirm new password");
    expect(html).toContain("Sign in");
    expect(html).not.toContain('type="email"');
    expect(html).not.toContain("reset link");
  });

  it("states that recovery is unavailable without the configured authenticator", () => {
    expect(renderRecovery()).toContain(
      "Without that authenticator, this account cannot be recovered.",
    );
  });
});
