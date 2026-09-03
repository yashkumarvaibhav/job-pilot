export const EMAIL_TEMPLATE_VARIABLES = [
  "first_name",
  "last_name",
  "company",
  "job_title",
  "job_id",
  "job_url",
  "my_name",
  "my_university",
  "resume_name",
] as const;

export type EmailTemplateVariable = (typeof EMAIL_TEMPLATE_VARIABLES)[number];

export const EMAIL_TEMPLATE_SHELL_TITLES = [
  "Employee referral request",
  "Alumni referral request",
  "Friend opening inquiry",
  "Recruiter cold email",
  "Hiring manager cold email",
  "Referral follow-up",
  "Opening inquiry follow-up",
  "Recruiter follow-up",
  "Post-OA follow-up",
  "Post-interview thank-you",
  "Application status follow-up",
  "Resume requested response",
  "Keep-in-touch message",
] as const;

export const EMAIL_TEMPLATE_SHELL_PLACEHOLDER =
  "Write this template in your own words.";

export type EmailTemplateWarning = {
  variable: string;
  reason: "missing" | "unsupported";
};

export type RenderedEmailTemplate = {
  subject: string;
  body: string;
  warnings: EmailTemplateWarning[];
};

const supportedVariables = new Set<string>(EMAIL_TEMPLATE_VARIABLES);
const placeholderPattern = /{{([a-z][a-z0-9_]*)}}/g;

export function renderEmailTemplate(
  template: { subject: string; body: string },
  values: Partial<Record<EmailTemplateVariable, string | null | undefined>>,
): RenderedEmailTemplate {
  const warnings: EmailTemplateWarning[] = [];
  const warned = new Set<string>();

  function substitute(text: string): string {
    return text.replace(placeholderPattern, (placeholder, variable: string) => {
      const supported = supportedVariables.has(variable);
      const value = supported
        ? values[variable as EmailTemplateVariable]
        : undefined;
      if (supported && typeof value === "string" && value.length > 0) {
        return value;
      }
      if (!warned.has(variable)) {
        warnings.push({
          variable,
          reason: supported ? "missing" : "unsupported",
        });
        warned.add(variable);
      }
      return placeholder;
    });
  }

  return {
    subject: substitute(template.subject),
    body: substitute(template.body),
    warnings,
  };
}
