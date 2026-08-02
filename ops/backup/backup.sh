#!/bin/sh
# One database backup.
#
# What is actually being protected here is worth being clear about, because it
# changes what "good enough" means. The bank transactions are re-fetchable —
# Akahu will hand them back on a fresh baseline pull. What is NOT recoverable
# is everything a human decided: which category each transaction belongs to,
# which transfers were confirmed as pairs, which book each account is in. That
# is hours of judgement stored nowhere else, and it is why this exists.
#
# Run by cron inside the backup container, and by `npm run db:backup` on
# demand.

set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"
# Never prune below this many, whatever the retention window says. Protects
# against the case where the clock is wrong or the job hasn't run for weeks:
# without it, a container that starts up after a long outage could delete
# every backup it has before making a new one.
MIN_KEEP="${BACKUP_MIN_KEEP:-7}"

: "${POSTGRES_USER:?POSTGRES_USER is not set}"
: "${POSTGRES_DB:?POSTGRES_DB is not set}"
: "${PGPASSWORD:?PGPASSWORD is not set}"
PGHOST="${PGHOST:-db}"
export PGHOST PGPASSWORD

log() { echo "[backup] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }

mkdir -p "$BACKUP_DIR"

stamp=$(date -u '+%Y%m%dT%H%M%SZ')
target="$BACKUP_DIR/${POSTGRES_DB}-${stamp}.dump"
partial="${target}.partial"

# Write to a .partial name and rename only once the dump is complete and has
# been verified. A rename within one filesystem is atomic, so a crash or a
# `docker compose down` mid-dump leaves a .partial file that is obviously
# junk, rather than a truncated .dump that looks like a real backup and is
# only discovered to be useless during a restore.
log "dumping ${POSTGRES_DB} from ${PGHOST}"

if ! pg_dump \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --format=custom \
  --compress=9 \
  --file="$partial"; then
  log "ERROR pg_dump failed"
  rm -f "$partial"
  exit 1
fi

# Read the dump's table of contents back. A custom-format dump that pg_restore
# cannot list is corrupt, and the whole point is to find that out now rather
# than on the worst day of the year.
if ! pg_restore --list "$partial" >/dev/null 2>&1; then
  log "ERROR dump is unreadable — pg_restore could not list it"
  rm -f "$partial"
  exit 1
fi

size=$(wc -c < "$partial" | tr -d ' ')

# Compare against the most recent previous backup. A dump that suddenly
# collapses to a fraction of its predecessor is the classic silent failure:
# it succeeds, it verifies, and it contains almost nothing — because someone
# pointed it at an empty database, or a migration dropped a table. Warn rather
# than fail, since a legitimate bulk delete looks identical from here.
previous=$(ls -1t "$BACKUP_DIR"/*.dump 2>/dev/null | head -n 1 || true)
if [ -n "$previous" ]; then
  previous_size=$(wc -c < "$previous" | tr -d ' ')
  if [ "$previous_size" -gt 0 ] && [ "$((size * 2))" -lt "$previous_size" ]; then
    log "WARNING new dump is ${size} bytes, less than half the previous ${previous_size} — check the database is not empty"
  fi
fi

mv "$partial" "$target"
log "wrote $(basename "$target") (${size} bytes)"

# --- Pruning ---------------------------------------------------------------
# Keep the newest MIN_KEEP unconditionally; among the rest, delete anything
# older than RETAIN_DAYS. Ordering matters: newest-first, skip the protected
# ones, then apply the age test to what remains.
total=$(ls -1 "$BACKUP_DIR"/*.dump 2>/dev/null | wc -l | tr -d ' ')

if [ "$total" -gt "$MIN_KEEP" ]; then
  ls -1t "$BACKUP_DIR"/*.dump 2>/dev/null | tail -n "+$((MIN_KEEP + 1))" | while read -r old; do
    # -mtime +N is "modified more than N days ago" in whole days.
    if [ -n "$(find "$old" -mtime "+${RETAIN_DAYS}" 2>/dev/null)" ]; then
      rm -f "$old"
      log "pruned $(basename "$old") (older than ${RETAIN_DAYS} days)"
    fi
  done
fi

# Leftover .partial files mean a previous run died. Clear ones that are
# clearly stale so they don't accumulate, but say so — a repeating message
# here means backups are failing halfway every night.
find "$BACKUP_DIR" -name '*.partial' -mtime +1 2>/dev/null | while read -r stale; do
  rm -f "$stale"
  log "WARNING removed stale partial $(basename "$stale") — a previous backup died mid-dump"
done

remaining=$(ls -1 "$BACKUP_DIR"/*.dump 2>/dev/null | wc -l | tr -d ' ')
log "done — ${remaining} backup(s) retained in ${BACKUP_DIR}"
