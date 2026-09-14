# Job Pilot

**A multi-tenant job-search CRM and outreach engine with deterministic workflows, explicit send approval, and verifiable data safety.**

[Try the public early-access build](https://jobpilot.yashkumarvaibhav.me) · [Check readiness](https://jobpilot.yashkumarvaibhav.me/api/ready)

![Job Pilot — run your job search from one clear workspace](public/og.png)

Job Pilot brings companies, contacts, opportunities, applications, referrals, interviews, tasks,
documents, email sequences, and analytics into one private workspace per account. Its automation is
intentionally deterministic: rules, templates, scoring formulas, saved searches, filters, and
parsers produce reviewable results. Every sequence message sent to a third party requires its own
approval; enrollment is not approval, and there is no bulk-approval path.

## Why this project is interesting

- **Mailbox consistency before automation.** Gmail sync uses incremental history and separates
  inbox freshness from proof that every active sequence thread has been reconciled. A history gap
  may refresh the inbox, but it cannot make an automated follow-up safe to send.
- **Tenant authority comes from the session.** Repository reads and writes are scoped to the
  authenticated workspace, while same-workspace composite foreign keys prevent cross-tenant
  relationships.
- **Authentication is built from explicit primitives.** Passwords use scrypt; only SHA-256 session
  digests are stored; mandatory TOTP secrets are encrypted with AES-256-GCM and verified with replay
  protection.
- **Backups are proved, not assumed.** SQLite snapshots use `VACUUM INTO`, carry row-count and file
  integrity manifests, and are restored and checked under a concurrent writer in the backup
  self-test. A pending migration fails closed if its just-in-time backup cannot be verified.
- **Due work is not materialized by a fragile daemon.** Today items and reminders are derived at
  read time in the workspace's IANA timezone; the background tick handles bounded external work.

## Product surface

| Area | What is implemented |
| --- | --- |
| CRM | Companies, contacts, opportunities, applications, referrals, interactions, tags, and an activity timeline |
| Daily loop | Today queue, tasks, reminders, notifications, interviews, assessments, stale flags, and opportunity health |
| Automation | Deterministic rules and scoring, saved searches, duplicate detection, CSV import, templates, and sequences |
| Gmail | Multiple account connections, incremental inbox sync, compose/queue, reply matching, suppression, and per-message approval |
| Platform | Username/password signup, mandatory TOTP, workspace isolation, document storage, analytics, export, backup, and restore |

## Architecture

```text
Browser
  └─ Next.js 16 App Router + React 19 + TypeScript strict
       ├─ route handlers and server-rendered application pages
       ├─ pure domain modules: state machines, scoring, rules, due work
       ├─ workspace-scoped repositories
       ├─ Gmail OAuth, incremental sync, matching, and send queue
       └─ SQLite 3 in WAL mode through Drizzle ORM

systemd timer
  └─ authenticated tick
       ├─ enumerates eligible work without selecting tenant authority
       └─ re-establishes workspace context for each claimed row
```

The supported release envelope is deliberately bounded to one application process, up to 100
registered accounts, and up to 10 simultaneously active users. A second process, a high-availability
requirement, or sustained SQLite lock contention is the trigger to measure and plan a PostgreSQL
migration; the current repository does not claim horizontal scaling.

## Gmail send safety

Job Pilot requests `openid`, `email`, `gmail.send`, and `gmail.readonly`. Refresh tokens are
encrypted at rest and bound to one workspace.

Incremental sync records two different facts:

| Stamp | What it proves | Can a Gmail history gap advance it? |
| --- | --- | --- |
| Inbox freshness | The mailbox view is current after sync or bounded recovery | Yes |
| Sequence safety | Every active-enrollment thread was reconciled and the final catch-up was clean | No |

A missing history range starts a leased, resumable recovery sweep. An enrollment linked after an
account-level sweep does not inherit earlier proof: its thread must be reconciled directly before a
follow-up becomes eligible. Even then, the exact message payload still needs the workspace owner's
approval before it can be sent.

Reply matching follows the same evidence rule. Exact thread, message, or unique contact evidence may
link automatically. Ambiguous matches are suggestions and do not mutate CRM state until confirmed.

## Security boundaries

- Opaque 256-bit session tokens are sent in `HttpOnly`, `SameSite=Lax` cookies; the database stores
  only their SHA-256 digests.
- Signup, password recovery, and credential changes are rate-limited and enumeration-resistant.
- TOTP codes are checked in constant time with a stored last-used counter to prevent replay.
- Gmail refresh tokens and TOTP secrets are encrypted with an environment-only key and never
  returned to the browser or written to activity payloads.
- Mutating routes enforce origin checks; authenticated responses are `no-store`; uploaded documents
  are validated, stored under generated workspace-scoped paths, and served only after authority
  checks.
- Inbound Gmail HTML is rendered as plain text rather than trusted inside an authenticated page.

## Local development

### Prerequisites

- Node.js 24
- npm

### Setup

```bash
git clone https://github.com/yashkumarvaibhav/job-pilot.git
cd job-pilot
npm install
cp .env.example .env
```

Replace every placeholder in `.env`. Generate the two local secrets with a cryptographically secure
random source; Gmail client values are needed only when exercising the Gmail connection.

```bash
npm run db:migrate:dev
npm run dev
```

Open <http://127.0.0.1:3061>. Development migration refuses to run when
`NODE_ENV=production`; production uses the guarded migration path below.

## Verification

```bash
npm test
npm run lint
npx tsc --noEmit
npm run test:responsive
npm run test:journeys
```

The Vitest suite covers domain rules, repositories, routes, UI behavior, tenant isolation, Gmail
sync, send safety, account lifecycle, backup, and migration behavior. Playwright projects exercise
responsive and end-to-end journeys separately.

## Operations

Data safety runs from the command line, not from service startup: an ordinary restart never depends
on backup health, while a schema change cannot happen without a verified snapshot behind it.

```bash
bin/backup                                      # verified snapshot of database and uploads
bin/backup --prune                              # expire old generations, then measure what remains
bin/restore <backup-dir> --into /tmp/x.sqlite   # restore and prove it without touching production
npm run db:migrate                              # back up first only when a migration is pending
npm run backup:selftest                         # back up under a concurrent writer, restore, verify
```

A snapshot is written with `VACUUM INTO`, so it is one consistent file with no `-wal`/`-shm`
sidecars and is safe to take while the service is serving. `manifest.json` records the schema
version, per-table row counts, byte sizes, and a SHA-256 for every stored document. No environment
value is copied into a backup.

`bin/restore` refuses anything but a fully verified snapshot and will not overwrite the live
database unless `--force` is given. A forced restore revokes the sessions and unused account tokens
carried by the snapshot.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_PATH` | `./var/job-pilot.sqlite` | Database read and migrated by the tools |
| `BACKUP_BUDGET_MB` | `2048` | Size ceiling reported after pruning |

### Service units

`deploy/` holds the canonical user units; `bin/install-units` copies them into
`~/.config/systemd/user`, reloads systemd, and verifies them.

```bash
bin/install-units
systemctl --user enable --now job-pilot.service
systemctl --user enable --now job-pilot-backup.timer
curl http://127.0.0.1:8061/api/ready
```

The application unit runs `npm run db:migrate` before starting, so a pending schema change is
preceded by a verified snapshot. The backup timer is independent: a failed backup is loud in the
journal and does not stop the application service.

> Do not run `npm run build` while a service is serving from the same checkout: the build replaces
> `.next` underneath the running process. Stop the unit, build, then start it again.

## Project status

Job Pilot is actively developed and publicly available for early access. Gmail functionality is a
limited pilot that depends on explicitly configured Google OAuth credentials and scopes. The
repository makes no claim of Google verification, high availability, or a user population.

No license has been granted for redistribution.
