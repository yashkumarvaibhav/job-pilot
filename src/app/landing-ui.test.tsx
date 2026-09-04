import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { LandingExperience } from "@/components/landing-experience";

const SETUP = {
  secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  uri: "otpauth://totp/Job%20Pilot%3Aowner_name?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Job+Pilot",
};

function render(authMode: "sign-in" | "sign-up" | "forgot-password" | "setup-totp" | null) {
  return renderToStaticMarkup(
    <LandingExperience
      authMode={authMode}
      demoAccount={null}
      setupAvailable
      signupAvailable
      totpSetup={SETUP}
    />,
  );
}

describe("public landing experience", () => {
  it("presents the implemented job-search loop and its safety boundary", () => {
    const html = render(null);

    expect(html).toContain("Run your job search from one clear workspace");
    expect(html).toContain("Create account");
    expect(html).toContain("Sign in");
    expect(html).toContain("Private by default");
    expect(html).toContain("Every third-party message waits for your approval");
    expect(html).toContain("Workflow preview");
    expect(html).not.toContain("customers");
  });

  it("renders sign in and signup as labelled dialogs", () => {
    const signIn = render("sign-in");
    const signUp = render("sign-up");

    for (const html of [signIn, signUp]) {
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain("Close account access");
    }
    expect(signIn).toContain("Forgot password?");
    expect(signUp).toContain("Step 1 of 2");
    expect(signUp).toContain("Continue to authenticator");
  });

  it("keeps recovery in the dialog and makes mandatory setup cancellable without a skip", () => {
    const recovery = render("forgot-password");
    const setup = render("setup-totp");

    expect(recovery).toContain("Reset password");
    expect(recovery).toContain("Authenticator code");
    expect(setup).toContain("Step 2 of 2");
    expect(setup).toContain("Authenticator setup QR code");
    expect(setup).toContain("Cancel account setup");
    expect(setup).not.toContain("Skip for now");
  });
});
