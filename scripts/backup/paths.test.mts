import { describe, expect, it } from "vitest";

import { resolveBackupPaths } from "./paths.mjs";

describe("resolveBackupPaths", () => {
  it("honours isolated database, uploads and backup roots from the environment", () => {
    expect(
      resolveBackupPaths({
        appRoot: "/srv/job-pilot/app",
        env: {
          DATABASE_PATH: "./var/demo/job-pilot.sqlite",
          UPLOADS_ROOT: "./var/demo/uploads",
          BACKUPS_ROOT: "./var/demo/backups",
        },
      }),
    ).toEqual({
      appRoot: "/srv/job-pilot/app",
      databasePath: "/srv/job-pilot/app/var/demo/job-pilot.sqlite",
      uploadsRoot: "/srv/job-pilot/app/var/demo/uploads",
      backupsRoot: "/srv/job-pilot/app/var/demo/backups",
    });
  });
});
