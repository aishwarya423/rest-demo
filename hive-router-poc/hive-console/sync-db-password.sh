#!/usr/bin/env bash
# ===========================================================================
# Reconcile the running PostgreSQL with POSTGRES_PASSWORD in .env.
# ===========================================================================
#   ./hive-console/sync-db-password.sh            # check, repair if needed
#   ./hive-console/sync-db-password.sh --check    # report only, change nothing
#   ./hive-console/sync-db-password.sh --no-restart
#
# Idempotent. When the password already matches it prints "in sync" and exits 0,
# so it is safe to run before every `up` and safe to run twice.
#
# ---------------------------------------------------------------------------
# THE FAILURE THIS FIXES
# ---------------------------------------------------------------------------
# POSTGRES_PASSWORD is applied by the postgres image ONLY at first initdb. Once
# ./.hive/postgres exists, the image logs
#
#   Database directory appears to contain a database; Skipping initialization
#
# and keeps whatever password the data directory was built with. So if .env is
# regenerated after the data directory exists, every Hive service fails with
#
#   error: password authentication failed for user "postgres"   (SQLSTATE 28P01)
#
# `migrations` exits 1, and `server` -- which has
# `depends_on: migrations: service_completed_successfully` -- never starts at
# all. The symptom is NOT a database error: `app` on :8080 is healthy and
# serves the login page, so signing in reports "Failed to fetch", because the
# API it posts to was never started. bootstrap-secrets.sh now carries the
# password forward to prevent the drift; this script repairs a stack that
# already drifted.
#
# ---------------------------------------------------------------------------
# WHY THE CHECK RUNS FROM A SEPARATE CONTAINER
# ---------------------------------------------------------------------------
# This is the trap that makes the fault look like it is not there. The data
# directory's pg_hba.conf is, in order:
#
#   local  all all                  trust
#   host   all all 127.0.0.1/32     trust
#   host   all all all              scram-sha-256
#
# So `docker exec db psql -U postgres` (Unix socket) and `psql -h 127.0.0.1`
# BOTH succeed without checking any password. Only a connection from another
# container, over the `hive` network, reaches the scram-sha-256 rule. That is
# the connection Hive's services make, so that is the one worth testing.
#
# The same ordering is what makes the repair possible: ALTER USER is issued
# over the socket, which is `trust`, so the old password is never needed.
#
# Only PostgreSQL needs this. ClickHouse, Redis and VersityGW all re-apply
# their credentials from the environment on every container start -- the
# ClickHouse entrypoint rewrites /etc/clickhouse-server/users.d/default-user.xml
# each boot, and that path is not a mounted volume -- so they cannot drift.
# ===========================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
ENV_FILE="$ROOT/.env"
COMPOSE=(docker compose -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.console.yml")

CHECK_ONLY=0
RESTART=1
for arg in "$@"; do
  case "$arg" in
    --check)      CHECK_ONLY=1 ;;
    --no-restart) RESTART=0 ;;
    -h|--help)    sed -n '2,12p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *)            echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

[[ -f "$ENV_FILE" ]] || {
  echo "no $ENV_FILE -- run ./hive-console/bootstrap-secrets.sh first" >&2
  exit 1
}

# Read only the three values needed, by key, rather than sourcing the file:
# .env also holds values containing ':' and '|' inside single quotes, and
# sourcing it would be a needless way to go wrong.
env_val() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1 | sed "s/^'//; s/'$//"; }
PGUSER_V="$(env_val POSTGRES_USER)"
PGPASS_V="$(env_val POSTGRES_PASSWORD)"
PGDB_V="$(env_val POSTGRES_DB)"
: "${PGUSER_V:=postgres}" "${PGDB_V:=registry}"

[[ -n "$PGPASS_V" ]] || { echo "POSTGRES_PASSWORD is empty in $ENV_FILE" >&2; exit 1; }

DB_CID="$("${COMPOSE[@]}" ps -q db 2>/dev/null || true)"
[[ -n "$DB_CID" ]] || {
  echo "the db container is not running. Start it first:"
  echo "  docker compose -f docker-compose.yml -f docker-compose.console.yml up -d db"
  exit 1
}

# The image tag and network are read from the running container so this keeps
# working across a Hive upgrade that changes the postgres version.
PG_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$DB_CID")"
NETWORK="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$DB_CID" | awk '{print $1}')"

# Probe exactly the way Hive's services connect: another container, over the
# network, so scram-sha-256 actually applies. 'db' is the in-network hostname.
probe() {
  docker run --rm --network "$NETWORK" \
    -e PGPASSWORD="$PGPASS_V" -e PGCONNECT_TIMEOUT=10 \
    "$PG_IMAGE" \
    psql -h db -U "$PGUSER_V" -d "$PGDB_V" -tAc 'select 1' >/dev/null 2>&1
}

if probe; then
  echo "postgres: in sync with POSTGRES_PASSWORD in .env"
  IN_SYNC=1
else
  echo "postgres: REJECTS the password in .env (this is the 28P01 fault)"
  IN_SYNC=0
fi

if [[ $IN_SYNC -eq 1 ]]; then
  [[ $CHECK_ONLY -eq 1 ]] && exit 0
elif [[ $CHECK_ONLY -eq 1 ]]; then
  echo
  echo "Re-run without --check to repair:"
  echo "  ./hive-console/sync-db-password.sh"
  exit 1
else
  echo "repairing: ALTER USER over the Unix socket, which pg_hba.conf trusts"
  # \set keeps the value out of the command line and out of the SQL text, so
  # no shell or SQL quoting can mangle a generated hex password. Passing
  # `-v pw=... -c '...'` does NOT work: with -c, psql never runs the \set.
  printf "\\set pw '%s'\nALTER USER %s WITH PASSWORD :'pw';\n" "$PGPASS_V" "$PGUSER_V" \
    | docker exec -i "$DB_CID" psql -U "$PGUSER_V" -d "$PGDB_V" -v ON_ERROR_STOP=1
  probe || { echo "still rejected after ALTER USER -- stopping" >&2; exit 1; }
  echo "postgres: now in sync"
fi

if [[ $RESTART -eq 0 ]]; then
  echo "(--no-restart: migrations and the dependent services were left alone)"
  exit 0
fi

# migrations is a one-shot job and is safe to re-run: it skips what is already
# applied. server/workflows/usage are the three that fail on a bad password,
# and server is the one whose absence shows up as "Failed to fetch" at login.
echo
echo "re-running migrations"
"${COMPOSE[@]}" up migrations --exit-code-from migrations

echo
echo "starting server workflows usage"
"${COMPOSE[@]}" up -d server workflows usage

echo
"${COMPOSE[@]}" ps --format '{{.Service}}\t{{.Status}}' \
  | grep -E '^(db|migrations|server|workflows|usage)	' || true
echo
echo "Console: http://localhost:8080   API: http://localhost:8082/graphql"
