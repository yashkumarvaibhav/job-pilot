import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import {
  ComposeForm,
  composeVariableValues,
  type ComposeContactOption,
} from "@/components/compose-form";

const accounts = [
  {
    id: "account-default",
    email: "default@invalid.test",
    senderName: "Default",
    signature: "Regards,\nYash",
    isDefault: true,
  },
  {
    id: "account-second",
    email: "second@invalid.test",
    senderName: "Second",
    signature: null,
    isDefault: false,
  },
];
const contacts = [
  {
    id: "rahul",
    name: "Rahul Sharma",
    email: "rahul@invalid.test",
    companyName: "Microsoft",
    doNotContact: false,
  },
];
const opportunities = [
  {
    id: "ms-sde",
    role: "Software Engineer",
    companyName: "Microsoft",
    jobId: "182763",
    url: "https://jobs.invalid.test/182763",
  },
];

function form(contactRows: ComposeContactOption[] = contacts) {
  return (
    <ComposeForm
      accounts={accounts}
      contacts={contactRows}
      documents={[{ id: "resume-v4", displayName: "General SWE v4" }]}
      initial={{ contactId: "rahul", opportunityId: "ms-sde" }}
      myName="Yash"
      myUniversity="IIIT Delhi"
      opportunities={opportunities}
      referrals={[]}
      templates={[
        {
          id: "template-referral",
          title: "Employee referral request",
          subject: "Hello {{first_name}}",
          body: "About {{job_title}}",
          defaultEmailAccountId: "account-second",
          defaultDocumentVersionId: "resume-v4",
        },
      ]}
      timeZone="Asia/Kolkata"
    />
  );
}

describe("composer UI", () => {
  it("shows every connected account and an exact final review", () => {
    const html = renderToStaticMarkup(form());

    expect(html).toContain("default@invalid.test — default");
    expect(html).toContain("second@invalid.test");
    expect(html).toContain("Rahul Sharma — rahul@invalid.test");
    expect(html).toContain("Employee referral request");
    expect(html).toContain("Review exactly what Gmail will send");
    expect(html).toContain("Chosen below in Asia/Kolkata; that click is the approval");
    expect(html).toContain("Send now from default@invalid.test");
    expect(html).toContain("Send tonight");
    expect(html).toContain("Send tomorrow morning");
    expect(html).toContain("Approve custom time");
    expect(html).toContain('type="submit"');
    expect(html).not.toContain(">Send anyway<");
  });

  it("builds the literal §15 values from the chosen CRM context", () => {
    expect(
      composeVariableValues({
        contact: contacts[0],
        opportunity: opportunities[0],
        document: { id: "resume-v4", displayName: "General SWE v4" },
        myName: "Yash",
        myUniversity: "IIIT Delhi",
      }),
    ).toEqual({
      first_name: "Rahul",
      last_name: "Sharma",
      company: "Microsoft",
      job_title: "Software Engineer",
      job_id: "182763",
      job_url: "https://jobs.invalid.test/182763",
      my_name: "Yash",
      my_university: "IIIT Delhi",
      resume_name: "General SWE v4",
    });
  });

  it("shows a text-and-icon hard block and removes Send now for Do Not Contact", () => {
    const html = renderToStaticMarkup(
      form([{ ...contacts[0], doNotContact: true }]),
    );

    expect(html).toContain("Email is blocked. There is no Send anyway button.");
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("Send now from");
  });

  it("shows a named suppression reason with no override control", () => {
    const html = renderToStaticMarkup(
      form([
        {
          ...contacts[0],
          suppressionReason: "Email is blocked by bounced suppression.",
          emailInvalid: true,
        },
      ]),
    );
    expect(html).toContain("Email is blocked by bounced suppression.");
    expect(html).toContain("There is no Send anyway button.");
    expect(html).toContain("(invalid)");
    expect(html).not.toContain("Send now from");
    expect(html).not.toContain(">Continue<");
  });

  it("uses tokens and stacks the review at the narrow breakpoint", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const composer = css.slice(css.indexOf("/* Gmail composer"), css.indexOf("body {", css.indexOf("/* Gmail composer")));

    expect(composer).toContain("var(--raised)");
    expect(composer).toContain("var(--line)");
    expect(composer).toContain("var(--warning)");
    expect(composer).toContain("var(--shadow-lg)");
    expect(composer).toContain(".compose-outreach-dialog");
    expect(composer).toContain("@media (max-width: 767px)");
    expect(composer).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
