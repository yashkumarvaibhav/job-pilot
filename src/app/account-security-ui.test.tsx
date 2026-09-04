import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { AccountForm } from "../components/account-form";
import {
  AccountSecurityPanel,
  TotpSetupPanel,
  TotpSkippedWarning,
} from "../components/account-security";
import { PasswordRecoveryForm } from "../components/password-recovery-form";
import { SignupProgress } from "../components/signup-progress";

const SETUP = {
  secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  uri: "otpauth://totp/Job%20Pilot%3Aowner_name?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Job+Pilot",
};

describe("username and authenticator UI", () => {
  it("asks signup and login for a username and never an email", () => {
    const signup = renderToStaticMarkup(<AccountForm mode="signup" />);
    const login = renderToStaticMarkup(<AccountForm mode="login" />);

    for (const html of [signup, login]) {
      expect(html).toContain("Username");
      expect(html).toContain('autoComplete="username"');
      expect(html).not.toContain('type="email"');
      expect(html).not.toContain("Email");
    }
    expect(signup).toContain("3–32 characters");
    expect(signup).toContain("Continue to authenticator");
  });

  it("names the current and completed stages without relying on colour", () => {
    const first = renderToStaticMarkup(<SignupProgress currentStep={1} />);
    const second = renderToStaticMarkup(<SignupProgress currentStep={2} />);

    expect(first).toContain('aria-current="step"');
    expect(first).toContain("Current step");
    expect(first).toContain("Next step");
    expect(second).toContain("Complete");
    expect(second).toContain("Current step");
  });

  it("shows a local QR, manual key and code field without a signup skip path", () => {
    const html = renderToStaticMarkup(
      <TotpSetupPanel available initialSetup={SETUP} onboarding />,
    );

    expect(html).toContain("Scan with your authenticator app");
    expect(html).toContain('aria-label="Authenticator setup QR code"');
    expect(html).toContain('viewBox="0 0 49 49"');
    expect(html).toContain("Can’t scan it?");
    expect(html).toContain("Manual setup key");
    expect(html).toContain(SETUP.secret);
    expect(html).toContain("Open authenticator app");
    expect(html).toContain("Six-digit code");
    expect(html).toContain("Enable authenticator");
    expect(html).not.toContain("Skip for now");
    expect(html).not.toContain("totp=skipped");
  });

  it("renders the skip warning with an icon and exact consequence", () => {
    const html = renderToStaticMarkup(<TotpSkippedWarning />);
    expect(html).toContain("Password recovery and password changes are unavailable until you set up an authenticator.");
    expect(html).toContain("svg");
    expect(html).toContain('role="status"');
  });

  it("keeps password change unavailable until TOTP is enabled", () => {
    const missing = renderToStaticMarkup(
      <AccountSecurityPanel
        available
        initialSetup={null}
        totpEnabled={false}
        username="owner_name"
      />,
    );
    expect(missing).toContain("Authenticator not set up");
    expect(missing).toContain("Set up authenticator");
    expect(missing).not.toContain("Current password");

    const enabled = renderToStaticMarkup(
      <AccountSecurityPanel
        available
        initialSetup={null}
        totpEnabled
        username="owner_name"
      />,
    );
    expect(enabled).toContain("Authenticator enabled");
    expect(enabled).toContain("Current password");
    expect(enabled).toContain("Authenticator code");
    expect(enabled).toContain("Change password");
  });

  it("uses username plus TOTP for forgot-password recovery", () => {
    const html = renderToStaticMarkup(<PasswordRecoveryForm />);
    expect(html).toContain("Username");
    expect(html).toContain("Authenticator code");
    expect(html).toContain("New password");
    expect(html).toContain("Confirm new password");
    expect(html).not.toContain("Email");
    expect(html).not.toContain("reset link");
  });
});
