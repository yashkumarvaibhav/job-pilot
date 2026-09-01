import { isAbsolute, relative, resolve } from "node:path";

export const DEMO_SIGNUP_CLOSED_MESSAGE =
  "Public account creation is closed for this demo.";
export const DEMO_IMPORT_DISABLED_MESSAGE =
  "Private CSV import is disabled in the public demo.";

type Environment = Record<string, string | undefined>;

const FORBIDDEN_DEMO_ENVIRONMENT = [
  /^GMAIL_/,
  /^GOOGLE_(?:CLIENT|OAUTH|MAIL)_/,
  /^SMTP_/,
  /^RESEND_/,
  /^MAILGUN_/,
  /^SENDGRID_/,
  /^POSTMARK_/,
  /^AWS_SES_/,
];

export function isDemoMode(env: Environment = process.env) {
  return env.JOB_PILOT_DEPLOYMENT_MODE?.trim() === "demo";
}

function required(env: Environment, key: string) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Demo configuration requires ${key}.`);
  return value;
}

function resolvedFrom(appRoot: string, value: string) {
  return isAbsolute(value) ? resolve(value) : resolve(appRoot, value);
}

function requireInside(label: string, candidate: string, directory: string) {
  const pathFromDirectory = relative(directory, candidate);
  if (
    pathFromDirectory === "" ||
    pathFromDirectory === ".." ||
    pathFromDirectory.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(pathFromDirectory)
  ) {
    throw new Error(`${label} must be a child of ${directory}.`);
  }
}

export function assertDemoConfiguration(
  env: Environment = process.env,
  appRoot = process.cwd(),
) {
  if (!isDemoMode(env)) {
    throw new Error("Demo configuration requires explicit demo mode.");
  }

  const demoRoot = resolve(appRoot, "var", "demo");
  const databasePath = resolvedFrom(appRoot, required(env, "DATABASE_PATH"));
  const uploadsRoot = resolvedFrom(appRoot, required(env, "UPLOADS_ROOT"));
  const backupsRoot = resolvedFrom(appRoot, required(env, "BACKUPS_ROOT"));
  requireInside("DATABASE_PATH", databasePath, demoRoot);
  requireInside("UPLOADS_ROOT", uploadsRoot, demoRoot);
  requireInside("BACKUPS_ROOT", backupsRoot, demoRoot);

  if (new Set([databasePath, uploadsRoot, backupsRoot]).size !== 3) {
    throw new Error("Demo database, uploads and backups paths must be distinct.");
  }

  const accountEmail = required(env, "DEMO_ACCOUNT_EMAIL").toLowerCase();
  const emailDomain = accountEmail.split("@")[1];
  if (!emailDomain || (emailDomain !== "invalid.test" && !emailDomain.endsWith(".invalid.test"))) {
    throw new Error("The demo account must use a non-deliverable invalid.test domain.");
  }
  required(env, "DEMO_ACCOUNT_PASSWORD");

  const forbidden = Object.entries(env).find(
    ([key, value]) =>
      value?.trim() && FORBIDDEN_DEMO_ENVIRONMENT.some((pattern) => pattern.test(key)),
  );
  if (forbidden) {
    throw new Error(`Demo configuration forbids ${forbidden[0]}.`);
  }

  return { databasePath, uploadsRoot, backupsRoot, accountEmail };
}
