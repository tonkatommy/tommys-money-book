#!/usr/bin/env bash
# Deploy one commit of main to this host.
#
# Runs on the homelab, as the SSH forced command for the deploy key that
# .github/workflows/deploy.yml holds (see README, "Deploying"). It can also be
# run by hand from the checkout: ops/deploy/deploy.sh <full-sha>.
#
# Order matters, and is chosen so that every failure leaves the old version
# running:
#   1. build the new images while the old containers keep serving
#   2. back up the database
#   3. apply migrations (`prisma migrate deploy`, never `migrate dev`)
#   4. only then swap the containers over, and check they came up
#
# There is no automatic rollback. Once a migration has run, putting the old
# code back on the new schema is its own risk, and that call belongs to a
# human holding the backup step 2 just took.
#
# Output goes to the GitHub Actions log, which is public on a public repo.
# Keep it to progress lines; never echo the environment.

set -euo pipefail

# Everything lives in main(), called on the last line. Step 1 moves this very
# file to the new commit's version, and bash reads a script lazily as it runs,
# so without the function it could carry on executing a mix of old and new
# lines. A function body is parsed in full before any of it runs.
main() {
  local repo
  repo=$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)
  cd "$repo"

  # Under a forced command sshd discards what the client asked to run and puts
  # it in SSH_ORIGINAL_COMMAND instead; by hand it is the first argument.
  # Either way it is untrusted input, so it is matched, never evaluated.
  local sha="${SSH_ORIGINAL_COMMAND:-${1:-}}"
  if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    fail "expected a full 40-character commit SHA, got '${sha:0:80}'"
  fi

  # Belt and braces with the workflow's concurrency group, which cannot see a
  # deploy started by hand.
  exec 9>"${TMPDIR:-/tmp}/moneybook-deploy.lock"
  flock -n 9 || fail "another deploy is already running"

  # The key can only deploy what is already on main. A SHA from a branch, a
  # fork or anywhere else is refused here, on the host, whatever the caller
  # claims.
  git fetch --quiet origin main
  git merge-base --is-ancestor "$sha" origin/main 2>/dev/null \
    || fail "$sha is not on origin/main"

  local branch
  branch=$(git symbolic-ref --short -q HEAD || true)
  [[ "$branch" == main ]] || fail "checkout is on '${branch:-detached HEAD}', not main"
  # Tracked files only. .env and the certs are gitignored, so they never trip
  # this; a hand edit to docker-compose.yml on the host does, and should.
  git diff --quiet HEAD -- || fail "tracked files have local edits; commit or discard them first"

  local previous
  previous=$(git rev-parse --short HEAD)
  # --ff-only: if main on this host has wandered off from origin, stop rather
  # than invent a merge commit nobody reviewed.
  git merge --ff-only --quiet "$sha"
  # If the checkout was already past $sha (an older release published after
  # a newer one, or a `git pull` by hand), the merge above is a silent no-op
  # and the newer code would be rebuilt under the older release's name. Going
  # backwards is a rollback, and a rollback after a migration is a human's
  # call; see the header.
  [[ "$(git rev-parse HEAD)" == "$sha" ]] \
    || fail "checkout is at $previous, which is newer than ${sha:0:7}; not rolling back"
  log "checked out ${sha:0:7} (was $previous)"

  log "building images"
  docker compose --profile tools build --quiet

  log "backing up the database"
  docker compose up -d --wait db backup
  docker compose exec -T backup /opt/backup/backup.sh

  log "applying migrations"
  docker compose --profile tools run --rm migrate

  log "restarting"
  docker compose up -d --remove-orphans

  log "waiting for the app"
  local ok=""
  for _ in $(seq 1 30); do
    # /login is the one page the proxy serves without a session.
    if curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:3000/login; then
      ok=1
      break
    fi
    sleep 2
  done
  [[ -n "$ok" ]] || fail "app did not answer on 127.0.0.1:3000/login within 60s"

  # A worker that cannot start (a missing Akahu token in live mode) restarts
  # in a loop rather than exiting, so "up" returning is not proof. Anything
  # not in the running state now is a failed deploy.
  local stuck
  stuck=$(docker compose ps --all --format '{{.Service}} {{.State}}' | awk '$2 != "running"')
  [[ -z "$stuck" ]] || fail "services not running: $(echo "$stuck" | tr '\n' ' ')"

  # Each build leaves the previous images dangling. A homelab disk fills
  # slowly and then all at once; this removes only untagged, unused images.
  docker image prune -f >/dev/null

  log "deployed ${sha:0:7}"
}

log() { echo "[deploy] $(date '+%Y-%m-%dT%H:%M:%S%z') $*"; }
fail() { log "FAILED: $*"; exit 1; }

main "$@"; exit
