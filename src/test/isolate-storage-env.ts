/**
 * Vitest workers inherit the operator shell. Absolute DATABASE_PATH / BACKUPS_ROOT
 * from the public early-access environment would make backup tests snapshot and
 * prune live storage. Tests that need a deployment mode pass it as an argument.
 */
delete process.env.DATABASE_PATH;
delete process.env.BACKUPS_ROOT;
delete process.env.UPLOADS_ROOT;
delete process.env.JOB_PILOT_DEPLOYMENT_MODE;
