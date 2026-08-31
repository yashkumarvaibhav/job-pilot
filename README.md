This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Operations

Data safety runs from the command line, not from service startup: an ordinary
restart never depends on backup health, while a schema change cannot happen
without a verified snapshot behind it.

```bash
bin/backup                                   # verified snapshot of the database and uploads
bin/backup --prune                           # expire old generations, then measure what remains
bin/restore <backup-dir> --into /tmp/x.sqlite  # restore and prove it, without touching production
npm run db:migrate                           # migrate; backs up first only when something is pending
npm run backup:selftest                      # back up under a concurrent writer, restore, verify
```

A snapshot is written with `VACUUM INTO`, so it is one consistent file with no
`-wal`/`-shm` sidecars and is safe to take while the service is serving.
`manifest.json` beside it records the schema version, per-table row counts,
byte sizes and a SHA-256 for every stored document. No environment value is
ever copied into a backup.

`bin/restore` refuses anything but a fully verified snapshot, and refuses to
overwrite the live database unless `--force` is given; a forced restore revokes
the sessions and unused account tokens the snapshot carried.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_PATH` | `./var/job-pilot.sqlite` | database the tools read and migrate |
| `BACKUP_BUDGET_MB` | `2048` | size ceiling reported after pruning |

### The service

`deploy/` holds the canonical user units; `bin/install-units` copies them into
`~/.config/systemd/user`, reloads systemd and verifies them.

```bash
bin/install-units
systemctl --user enable --now job-pilot.service        # serves 127.0.0.1:8061
systemctl --user enable --now job-pilot-backup.timer   # daily backup and sweep
curl http://127.0.0.1:8061/api/ready                   # {"ok":true}
```

The app unit runs `npm run db:migrate` before starting, so a schema change is
always preceded by a verified snapshot while an ordinary restart takes no backup
at all. The backup timer is independent of the app: a failed backup is loud in
the journal and never stops the service.

**Never run `npm run build` while `job-pilot.service` is active** — the build
replaces `.next` underneath the running server. Stop the unit, build, start it.
