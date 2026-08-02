# Nightly Postgres Backups — Design

**Date:** 02/08/2026
**Status:** Approved
**Precedes:** Phase 3 (MVP — transaction list + dashboard)

## Problem

Phase 2 is merged and the app now holds a year of real financial data (2,687
transactions across 11 accounts) with **no backup**. `docker-compose.yml`
still carries the comment "Nightly pg_dump backup job gets added here in a
later phase" from Phase 0. The implementation plan (§7) and the README's
Status section both call this out as a prerequisite for Phase 3 — the app is
about to become the live, go-to tool, and there's a year of data one bad
`docker compose down -v` away from gone.

## Goal

Automated nightly `pg_dump` backups, retained on a rolling window, with a
documented (manual) restore procedure. Nothing more — no dashboard
integration, no off-box sync, no automated restore verification. Those are
reasonable future additions, not required to close the "no backup" gap.

## Architecture

A fourth Docker Compose service, `backup`, added alongside `db`, `app`, and
`worker`. It's a new stage in the existing multi-stage `Dockerfile`, built
`FROM postgres:17-alpine` — the same base image as the `db` service, which
guarantees `pg_dump`'s version always matches the server. This avoids the
classic "backup tool is a different major version than the server" failure
mode.

The service runs busybox `crond` in the foreground as its main process. The
schedule is baked into the image at **3am Pacific/Auckland**, ahead of the
worker's 7am daily sync, so a backup never races a sync run. Changing the
schedule requires editing the crontab file and rebuilding the image — the
same tradeoff the project already accepts for `Dockerfile` changes generally,
and not worth the added complexity of templating a crontab from an env var
for a single-user homelab job.

```
services:
  backup:
    build:
      context: .
      target: backup
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      PGHOST: db
      POSTGRES_USER: ${POSTGRES_USER:-moneybook}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: ${POSTGRES_DB:-moneybook}
      BACKUP_RETENTION_DAYS: ${BACKUP_RETENTION_DAYS:-30}
      TZ: Pacific/Auckland
    volumes:
      - db-backups:/backups
    # No ports — same "nothing reaches in" posture as the worker.

volumes:
  db-backups:
```

## Dockerfile stage

A fifth stage, added after the existing `worker` stage:

```dockerfile
# ---- Stage 5: nightly backup ------------------------------------------------
# Built from the same postgres image as `db` so pg_dump's version always
# matches the server being dumped. Runs busybox crond in the foreground as
# the container's main process; the schedule lives in the crontab file below,
# not an env var, so it survives container restarts without a templating step.
FROM postgres:17-alpine AS backup
WORKDIR /
COPY docker/backup.sh /backup.sh
RUN chmod +x /backup.sh \
  && echo "0 3 * * * /backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
CMD ["crond", "-f", "-l", "2"]
```

## Backup script (`docker/backup.sh`)

```sh
#!/bin/sh
set -eu

FILE="/backups/moneybook-$(date +%Y-%m-%dT%H-%M-%S).sql.gz"

echo "[backup] $(date -Iseconds) starting dump -> ${FILE}"
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h "$PGHOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  | gzip > "$FILE"
echo "[backup] $(date -Iseconds) dump complete: $(du -h "$FILE" | cut -f1)"

find /backups -name 'moneybook-*.sql.gz' -mtime +"${BACKUP_RETENTION_DAYS}" -delete
echo "[backup] $(date -Iseconds) pruned backups older than ${BACKUP_RETENTION_DAYS} days"
```

Plain SQL, gzip-compressed — not `pg_dump -Fc`. Restoring is a plain
`gunzip | psql`, no `pg_restore` needed, and a dump can be eyeballed with
`zcat` if there's ever a question about what's in one. The DB is small enough
that custom-format's selective/parallel restore and smaller size buy nothing
here.

Output goes to the container's stdout (`>> /proc/1/fd/1`), so
`docker compose logs backup` shows dump history exactly the way
`docker compose logs worker` already shows sync history.

## Retention

`BACKUP_RETENTION_DAYS` (default 30), env-configurable without a rebuild
since the script reads it fresh on every cron firing. The script prunes
anything older than the window on every run, so the volume stays bounded at
roughly 30 nightly dumps rather than growing forever.

## Restore procedure (documented, manual)

Added to the README under a new "Backups" subsection:

```bash
gunzip -c db-backups/moneybook-<timestamp>.sql.gz \
  | docker compose exec -T db psql -U moneybook -d moneybook
```

Implementation plan §7 calls for *periodically* testing a restore — that
stays a manual, documented step. Automating a full restore-verification
pipeline (spin up a scratch Postgres, restore into it, diff against source)
is more machinery than a single-user homelab backup job justifies right now.
It can be revisited if the manual process turns out to be neglected in
practice.

## Verification

No app code is added here, so there's nothing to unit test. Verification is
operational, done once the service is built:

1. `docker compose build backup` — confirms the new Dockerfile stage builds.
2. `docker compose up -d backup` — confirms the service starts and `crond`
   stays running (`docker compose ps` shows it healthy/up, not restarting).
3. `docker compose exec backup /backup.sh` — manually trigger one dump
   outside the cron schedule, confirm it exits 0.
4. Confirm a `moneybook-<timestamp>.sql.gz` file exists in the `db-backups`
   volume and is non-empty.
5. One smoke restore: `gunzip -c` that file into a scratch database (not the
   real `moneybook` DB) and confirm `psql` reports no errors — proves the
   dump is valid, restorable SQL, not just a script that ran without
   crashing.

## Out of scope

- Dashboard/UI surfacing of backup status or last-run time
- Off-box or NAS sync of the backup volume
- Automated restore-verification pipeline
- Alerting on backup failure (beyond what's visible in `docker compose logs`)

These are reasonable future work, not required to close the current gap:
zero backups of a year of real financial data.
