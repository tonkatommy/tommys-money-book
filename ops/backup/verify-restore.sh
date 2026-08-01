#!/bin/sh
# Prove the newest backup can actually be restored.
#
# "We take nightly backups" and "we can restore" are different claims, and
# only the second one matters. This restores the most recent dump into a
# throwaway database, counts what came back, and drops it again — so the
# answer is a fact rather than an assumption.
#
# It never touches the real database. The scratch database is created and
# dropped here; the live one is only ever read from by pg_dump.
#
# Restoring *over* the real database is deliberately not scripted. That is a
# decision someone should make slowly, with the command in front of them —
# see the README.

set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
: "${POSTGRES_USER:?POSTGRES_USER is not set}"
: "${POSTGRES_DB:?POSTGRES_DB is not set}"
: "${PGPASSWORD:?PGPASSWORD is not set}"
PGHOST="${PGHOST:-db}"
export PGHOST PGPASSWORD

SCRATCH="${POSTGRES_DB}_restore_check"

log() { echo "[verify-restore] $*"; }

dump="${1:-}"
if [ -z "$dump" ]; then
  dump=$(ls -1t "$BACKUP_DIR"/*.dump 2>/dev/null | head -n 1 || true)
fi

if [ -z "$dump" ] || [ ! -f "$dump" ]; then
  log "ERROR no backup found in ${BACKUP_DIR}"
  exit 1
fi

log "verifying $(basename "$dump")"

psql_root() {
  # client_min_messages=warning suppresses the "database does not exist,
  # skipping" NOTICE from the DROP ... IF EXISTS below. That message is
  # expected on every clean run, and log noise that always appears is log
  # noise nobody reads.
  PGOPTIONS='-c client_min_messages=warning' \
    psql --username="$POSTGRES_USER" --dbname=postgres --quiet --no-align \
      --tuples-only "$@"
}

# Drop any leftover from an interrupted previous run before recreating, so a
# failed verification never blocks the next one.
psql_root --command="DROP DATABASE IF EXISTS \"$SCRATCH\";" >/dev/null
psql_root --command="CREATE DATABASE \"$SCRATCH\";" >/dev/null

cleanup() {
  psql_root --command="DROP DATABASE IF EXISTS \"$SCRATCH\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --exit-on-error turns a partially restored database into a failure. Without
# it pg_restore reports errors and carries on, which would let a half-restored
# database pass this check.
if ! pg_restore \
  --username="$POSTGRES_USER" \
  --dbname="$SCRATCH" \
  --exit-on-error \
  --no-owner \
  "$dump" >/dev/null; then
  log "FAILED restore did not complete cleanly"
  exit 1
fi

counts=$(psql --username="$POSTGRES_USER" --dbname="$SCRATCH" --quiet \
  --no-align --tuples-only --command="
    SELECT
      (SELECT count(*) FROM \"Transaction\") || ' transactions, ' ||
      (SELECT count(*) FROM \"Transaction\" WHERE \"categoryId\" IS NOT NULL) || ' categorised, ' ||
      (SELECT count(DISTINCT \"transferPairId\") FROM \"Transaction\" WHERE \"transferPairId\" IS NOT NULL) || ' transfer pairs, ' ||
      (SELECT count(*) FROM \"Category\") || ' categories, ' ||
      (SELECT count(*) FROM \"CategoryRule\") || ' rules, ' ||
      (SELECT count(*) FROM \"Account\") || ' accounts';")

log "restored OK: ${counts}"

# An empty restore is a successful restore of nothing, which is the failure
# mode this whole script exists to catch.
transactions=$(psql --username="$POSTGRES_USER" --dbname="$SCRATCH" --quiet \
  --no-align --tuples-only --command="SELECT count(*) FROM \"Transaction\";")

if [ "$transactions" -eq 0 ]; then
  log "FAILED the restored database has no transactions"
  exit 1
fi

log "PASS — $(basename "$dump") is restorable"
