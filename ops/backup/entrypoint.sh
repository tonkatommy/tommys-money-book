#!/bin/sh
# The backup container's main process.
#
# Installs a crontab and hands off to busybox crond in the foreground, so the
# container's lifetime is the scheduler's lifetime and `docker compose logs
# backup` is the complete backup history.

set -eu

BACKUP_CRON="${BACKUP_CRON:-0 2 * * *}"
VERIFY_CRON="${BACKUP_VERIFY_CRON:-30 3 * * 0}"

log() { echo "[backup] $*"; }

# busybox crond runs jobs with a near-empty environment — it does NOT inherit
# the container's env the way you'd expect. Without this, every scheduled run
# would fail on the `: "${PGPASSWORD:?}"` guard while a manual
# `docker compose exec backup /opt/backup/backup.sh` worked perfectly, which
# is a maddening thing to debug. So: freeze the environment to a file now, and
# have each cron job source it.
escape_squotes() { printf "%s" "$1" | sed "s/'/'\\''/g"; }

{
  echo "export POSTGRES_USER='$(escape_squotes "${POSTGRES_USER}")'"
  echo "export POSTGRES_DB='$(escape_squotes "${POSTGRES_DB}")'"
  echo "export PGPASSWORD='$(escape_squotes "${PGPASSWORD}")'"
  echo "export PGHOST='$(escape_squotes "${PGHOST:-db}")'"
  echo "export BACKUP_DIR='$(escape_squotes "${BACKUP_DIR:-/backups}")'"
  echo "export BACKUP_RETAIN_DAYS='$(escape_squotes "${BACKUP_RETAIN_DAYS:-30}")'"
  echo "export BACKUP_MIN_KEEP='$(escape_squotes "${BACKUP_MIN_KEEP:-7}")'"
} > /etc/backup.env
chmod 600 /etc/backup.env

mkdir -p /etc/crontabs
{
  echo "${BACKUP_CRON} . /etc/backup.env && /opt/backup/backup.sh"
  # A weekly restore test. A backup nobody has ever restored is a hypothesis,
  # and the point of automating the test is that it keeps being true rather
  # than having been true once.
  echo "${VERIFY_CRON} . /etc/backup.env && /opt/backup/verify-restore.sh"
} > /etc/crontabs/root

log "schedule: backup '${BACKUP_CRON}', restore test '${VERIFY_CRON}' (TZ=${TZ:-UTC})"
log "retaining ${BACKUP_RETAIN_DAYS:-30} days, never fewer than ${BACKUP_MIN_KEEP:-7} dumps"

if [ "${BACKUP_ON_START:-false}" = "true" ]; then
  log "BACKUP_ON_START=true — taking one now"
  /opt/backup/backup.sh || log "startup backup failed; the schedule will retry"
fi

# -f foreground, -l 8 log level, -L /dev/stdout so cron's own messages land in
# the container log alongside the scripts' output.
exec crond -f -l 8 -L /dev/stdout
