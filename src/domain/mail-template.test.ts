import { describe, expect, it } from "vitest";

import {
  EMAIL_TEMPLATE_VARIABLES,
  renderEmailTemplate,
} from "./mail-template";

describe("email template substitution", () => {
  it("substitutes all nine §15 variables literally", () => {
    const values = {
      first_name: "Rahul",
      last_name: "Sharma",
      company: "Microsoft",
      job_title: "Software Engineer",
      job_id: "182763",
      job_url: "https://jobs.invalid.test/182763",
      my_name: "Yash",
      my_university: "IIIT Delhi",
      resume_name: "General SWE v4",
    };

    expect(EMAIL_TEMPLATE_VARIABLES).toEqual(Object.keys(values));
    expect(
      renderEmailTemplate(
        {
          subject: "{{first_name}} — {{job_title}}",
          body: EMAIL_TEMPLATE_VARIABLES.map((name) => `{{${name}}}`).join("|"),
        },
        values,
      ),
    ).toEqual({
      subject: "Rahul — Software Engineer",
      body: Object.values(values).join("|"),
      warnings: [],
    });
  });

  it("leaves missing and unsupported placeholders intact and warns once each", () => {
    expect(
      renderEmailTemplate(
        {
          subject: "Hello {{first_name}} {{last_name}}",
          body: "{{company}} / {{first_name}} / {{custom_note}}",
        },
        { first_name: "Rahul", company: "" },
      ),
    ).toEqual({
      subject: "Hello Rahul {{last_name}}",
      body: "{{company}} / Rahul / {{custom_note}}",
      warnings: [
        { variable: "last_name", reason: "missing" },
        { variable: "company", reason: "missing" },
        { variable: "custom_note", reason: "unsupported" },
      ],
    });
  });

  it("does not interpret values as template syntax", () => {
    expect(
      renderEmailTemplate(
        { subject: "{{first_name}}", body: "{{company}}" },
        {
          first_name: "{{company}}",
          company: "$& and {{first_name}}",
        },
      ),
    ).toEqual({
      subject: "{{company}}",
      body: "$& and {{first_name}}",
      warnings: [],
    });
  });
});
