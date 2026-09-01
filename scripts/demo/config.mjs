import { isAbsolute, relative, resolve, sep } from "node:path";

const FORBIDDEN_ENVIRONMENT = [
  /^GMAIL_/,
  /^GOOGLE_(?:CLIENT|OAUTH|MAIL)_/,
  /^SMTP_/,
  /^RESEND_/,
  /^MAILGUN_/,
  /^SENDGRID_/,
  /^POSTMARK_/,
  /^AWS_SES_/,
];

function required(env, key) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Demo configuration requires ${key}.`);
  return value;
}

function resolveFrom(appRoot, value) {
  return isAbsolute(value) ? resolve(value) : resolve(appRoot, value);
}

function requireChild(label, candidate, directory) {
  const pathFromDirectory = relative(directory, candidate);
  if (
    pathFromDirectory === "" ||
    pathFromDirectory === ".." ||
    pathFromDirectory.startsWith(`..${sep}`) ||
    isAbsolute(pathFromDirectory)
  ) {
    throw new Error(`${label} must be a child of ${directory}.`);
  }
}

export function assertDemoEnvironment({ appRoot = process.cwd(), env = process.env } = {}) {
  if (env.JOB_PILOT_DEPLOYMENT_MODE?.trim() !== "demo") {
    throw new Error("Demo configuration requires explicit demo mode.");
  }

  const root = resolve(appRoot);
  const demoRoot = resolve(root, "var", "demo");
  const databasePath = resolveFrom(root, required(env, "DATABASE_PATH"));
  const uploadsRoot = resolveFrom(root, required(env, "UPLOADS_ROOT"));
  const backupsRoot = resolveFrom(root, required(env, "BACKUPS_ROOT"));
  requireChild("DATABASE_PATH", databasePath, demoRoot);
  requireChild("UPLOADS_ROOT", uploadsRoot, demoRoot);
  requireChild("BACKUPS_ROOT", backupsRoot, demoRoot);

  if (new Set([databasePath, uploadsRoot, backupsRoot]).size !== 3) {
    throw new Error("Demo database, uploads and backups paths must be distinct.");
  }

  const accountEmail = required(env, "DEMO_ACCOUNT_EMAIL").toLowerCase();
  const emailDomain = accountEmail.split("@")[1];
  if (!emailDomain || (emailDomain !== "invalid.test" && !emailDomain.endsWith(".invalid.test"))) {
    throw new Error("The demo account must use a non-deliverable invalid.test domain.");
  }
  const accountPassword = required(env, "DEMO_ACCOUNT_PASSWORD");

  const forbidden = Object.entries(env).find(
    ([key, value]) =>
      value?.trim() && FORBIDDEN_ENVIRONMENT.some((pattern) => pattern.test(key)),
  );
  if (forbidden) throw new Error(`Demo configuration forbids ${forbidden[0]}.`);

  return {
    appRoot: root,
    demoRoot,
    databasePath,
    uploadsRoot,
    backupsRoot,
    accountEmail,
    accountPassword,
  };
}
