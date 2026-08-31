// A writer for the backup self-test: opens the database in its own process and
// commits rows until it is killed, so `VACUUM INTO` really is racing a writer
// rather than photographing a still object.
import { appendFileSync } from "node:fs";

import Database from "better-sqlite3";

const databasePath = process.argv[2];
const logPath = process.argv[3];

function log(message) {
  if (logPath) {
    appendFileSync(logPath, `${message}\n`);
  }
}

const database = new Database(databasePath);
database.pragma("busy_timeout = 5000");
const insert = database.prepare(
  "insert into activity_event (id, workspace_id, at, kind, entity_type, entity_id, payload_json)" +
    " values (?, 'workspace-a', ?, 'selftest.write', 'workspace', 'workspace-a', '{}')",
);

const idle = new Int32Array(new SharedArrayBuffer(4));
const deadline = Date.now() + 20_000;
let written = 0;
log(`writer started on ${databasePath}`);
while (Date.now() < deadline) {
  insert.run(`event-${written}`, Date.now());
  written += 1;
  if (written % 25 === 0) {
    log(`writer committed ${written}`);
  }
  Atomics.wait(idle, 0, 0, 1);
}
database.close();
