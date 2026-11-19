#!/usr/bin/env bash
# ===========================================================================
# Generate the secrets the self-hosted Hive Console stack requires.
# ===========================================================================
# Writes hive-router-poc/.env, which Docker Compose loads automatically.
#
#   ./hive-console/bootstrap-secrets.sh              # create .env if absent
#   ./hive-console/bootstrap-secrets.sh --force      # regenerate
#   ./hive-console/bootstrap-secrets.sh --force --rotate-db   # ...incl. the DB
#
# Regenerating invalidates every existing session and CDN token in the running
# installation. Clear hive-console/.hive/ as well for a genuinely clean start.
#
# ---------------------------------------------------------------------------
# WHY --force DOES NOT TOUCH THE DATABASE PASSWORD BY DEFAULT
# ---------------------------------------------------------------------------
# The postgres image applies POSTGRES_PASSWORD only at first initdb. Once
# .hive/postgres exists it logs "Database directory appears to contain a
# database; Skipping initialization" and keeps the password the data directory
# was built with. A --force that generated a fresh one would leave .env and the
# database disagreeing, and every Hive service would fail with
#
#   error: password authentication failed for user "postgres"   (28P01)
#
# `migrations` then exits 1, and `server` -- which waits on
# `migrations: service_completed_successfully` -- never starts. Because `app`
# on :8080 is independent and stays healthy, the login page loads and signing
# in reports "Failed to fetch": the symptom points at the browser, not the
# database. HIVE_ENCRYPTION_SECRET has the same shape of problem -- it decrypts
# values already stored in that database.
#
# So when .hive/postgres is present, both are CARRIED FORWARD from the existing
# .env rather than regenerated. Everything else still rotates.
#
# --rotate-db overrides that deliberately; it prints the one follow-up command
# needed to bring the running database into line (sync-db-password.sh).
#
# Why a script and not a committed .env: the official guide generates these
# with "openssl rand" in a shell. A Compose .env file does NOT run command
# substitution, so the resolved values have to be written out once.
#
# NOTE: the generated file is written with a QUOTED heredoc and pre-computed
# variables. Do not switch it to an unquoted heredoc -- the prose contains
# characters that a shell would try to execute.
# ===========================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$(dirname "$HERE")/.env"
FORCE=0
ROTATE_DB=0
for arg in "$@"; do
  case "$arg" in
    --force)     FORCE=1 ;;
    --rotate-db) ROTATE_DB=1 ;;
    -h|--help)   sed -n '2,12p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *)           echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [[ -f "$ENV_FILE" && $FORCE -eq 0 ]]; then
  echo "$ENV_FILE already exists. Use --force to regenerate (this invalidates"
  echo "all existing sessions and tokens; delete hive-console/.hive/ as well)."
  exit 0
fi

command -v openssl >/dev/null || { echo "openssl is required"; exit 1; }

# ---------------------------------------------------------------------------
# Decide what must be carried forward, BEFORE generating anything.
# ---------------------------------------------------------------------------
# Read by key rather than sourcing: .env holds values containing ':' and '|'.
env_val() { [[ -f "$ENV_FILE" ]] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1 | sed "s/^'//; s/'\$//"; }

PG_DATA_DIR="$HERE/.hive/postgres"
CARRIED=""

if [[ -d "$PG_DATA_DIR" ]]; then
  if [[ $ROTATE_DB -eq 1 ]]; then
    echo "--rotate-db: generating a NEW POSTGRES_PASSWORD although $PG_DATA_DIR exists."
    echo "             The running database will reject it until you run:"
    echo "               ./hive-console/sync-db-password.sh"
    echo
  else
    CARRY_PG="$(env_val POSTGRES_PASSWORD)"
    CARRY_ENC="$(env_val HIVE_ENCRYPTION_SECRET)"
    if [[ -z "$CARRY_PG" ]]; then
      echo "$PG_DATA_DIR exists, but no POSTGRES_PASSWORD could be read from"
      echo "$ENV_FILE -- so the password that database was built with is not"
      echo "recoverable from here. Pick one:"
      echo
      echo "  # keep the data, set the database to a new generated password"
      echo "  ./hive-console/bootstrap-secrets.sh --force --rotate-db"
      echo "  ./hive-console/sync-db-password.sh"
      echo
      echo "  # or discard Hive's databases and start clean"
      echo "  docker compose -f docker-compose.yml -f docker-compose.console.yml down -v"
      echo "  rm -rf hive-console/.hive"
      echo "  ./hive-console/bootstrap-secrets.sh --force"
      exit 1
    fi
    CARRIED="POSTGRES_PASSWORD HIVE_ENCRYPTION_SECRET"
  fi
fi

GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PG_PASSWORD="$(openssl rand -hex 32)"
CH_PASSWORD="$(openssl rand -hex 32)"
REDIS_PW="$(openssl rand -hex 32)"
S3_PASSWORD="$(openssl rand -hex 32)"
ENCRYPTION_SECRET="$(openssl rand -hex 16)"
CDN_PRIVATE_KEY="$(openssl rand -hex 32)"
REFRESH_TOKEN_KEY="1000:$(openssl rand -hex 64):$(openssl rand -hex 64)"

# Keep the two values that an existing .hive/postgres pins. See the header.
[[ -n "${CARRY_PG:-}" ]] && PG_PASSWORD="$CARRY_PG"
[[ -n "${CARRY_ENC:-}" ]] && ENCRYPTION_SECRET="$CARRY_ENC"

# Hive's native auth needs an RSA keypair, supplied as
# <key-id>|<base64 public body>|<base64 private body>, i.e. the PEM bodies with
# the header, footer and newlines stripped.
KEY_NAME="$(openssl rand -hex 16)"
PRIVATE_KEY_PEM="$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null)"
PUBLIC_KEY_PEM="$(printf '%s\n' "$PRIVATE_KEY_PEM" | openssl rsa -pubout 2>/dev/null)"
strip_pem() { awk 'NF {if (NR != 1 && $0 !~ /-----END/) print}' | tr -d '\n'; }
PRIVATE_KEY_DATA="$(printf '%s\n' "$PRIVATE_KEY_PEM" | strip_pem)"
PUBLIC_KEY_DATA="$(printf '%s\n' "$PUBLIC_KEY_PEM" | strip_pem)"
ACCESS_TOKEN_KEY="${KEY_NAME}|${PUBLIC_KEY_DATA}|${PRIVATE_KEY_DATA}"

# Static prose, written verbatim. Values are appended separately below so that
# nothing in the commentary is ever interpreted by the shell.
cat > "$ENV_FILE" <<'HEADER'
# ===========================================================================
# Local development secrets for the self-hosted Hive Console stack.
# GENERATED by hive-console/bootstrap-secrets.sh -- do not commit.
# Not for any shared or production environment.
#
# Values you must still fill in BY HAND are at the bottom, under
# "FILLED IN AFTER FIRST LOGIN" -- they come from the Console UI.
# ===========================================================================
HEADER

{
  echo "# generated: ${GENERATED_AT}"
  cat <<'SECTION'

# --- Hive release -----------------------------------------------------------
# The Compose file and the images must come from the same release.
# Trailing slash on DOCKER_REGISTRY and leading colon on DOCKER_TAG are required.
SECTION
  echo "HIVE_VERSION=15.0.1"
  echo "DOCKER_REGISTRY=ghcr.io/graphql-hive/"
  echo "DOCKER_TAG=:15.0.1"

  cat <<'SECTION'

# --- public URLs ------------------------------------------------------------
SECTION
  echo "HIVE_APP_BASE_URL=http://localhost:8080"

  cat <<'SECTION'

# --- PostgreSQL (registry: orgs, projects, targets, schema versions) --------
SECTION
  echo "POSTGRES_DB=registry"
  echo "POSTGRES_USER=postgres"
  echo "POSTGRES_PASSWORD=${PG_PASSWORD}"

  cat <<'SECTION'

# --- ClickHouse (operation usage data) --------------------------------------
SECTION
  echo "CLICKHOUSE_USER=clickhouse"
  echo "CLICKHOUSE_PASSWORD=${CH_PASSWORD}"

  cat <<'SECTION'

# --- Redis (Hive's own cache; NOT the POC's Valkey on 6379) -----------------
SECTION
  echo "REDIS_PASSWORD=${REDIS_PW}"

  cat <<'SECTION'

# --- S3-compatible artifact storage (VersityGW) -----------------------------
# NOTE: hive@15 renamed these from MINIO_ROOT_USER / MINIO_ROOT_PASSWORD.
# The published get-started guide still shows the MINIO_* names; with hive@15
# those leave the S3 credentials empty and artifact storage fails.
SECTION
  echo "S3_ROOT_USER=hiveadmin"
  echo "S3_ROOT_PASSWORD=${S3_PASSWORD}"

  cat <<'SECTION'

# --- application secrets ----------------------------------------------------
# Quoted: these contain ':' and '|', so quoting keeps the file safe to source
# from a shell as well as readable by Compose.
SECTION
  echo "HIVE_ENCRYPTION_SECRET=${ENCRYPTION_SECRET}"
  echo "CDN_AUTH_PRIVATE_KEY=${CDN_PRIVATE_KEY}"
  echo "SUPERTOKENS_REFRESH_TOKEN_KEY='${REFRESH_TOKEN_KEY}'"
  echo "SUPERTOKENS_ACCESS_TOKEN_KEY='${ACCESS_TOKEN_KEY}'"

  cat <<'SECTION'

# --- logging ----------------------------------------------------------------
LOG_LEVEL=info

# ===========================================================================
# POC settings (unchanged from the original hive-router-poc)
# ===========================================================================
ACCOUNTS_API_KEY=accounts-local-key
POLICIES_API_KEY=policies-local-key
FUNDS_API_KEY=funds-local-key
CACHE_ENABLED=1
CACHE_EXTENSION_METADATA=1
ACCOUNTS_TTL_MS=30000
POLICIES_TTL_MS=120000
FUNDS_TTL_MS=300000

# ===========================================================================
# FILLED IN AFTER FIRST LOGIN -- see README, "Connect the router to the registry"
# ===========================================================================
# These cannot be generated: they are created through the Console UI at
# http://localhost:8080 once the stack is up.
#
# HIVE_TOKEN
#   Target -> Settings -> Access Tokens. Needs "Publish schema" and
#   "Check schema" permissions on the target.
#
# HIVE_CDN_ENDPOINT / HIVE_CDN_KEY
#   Target -> Connect to CDN. Self-hosted there is no real CDN; the artifact
#   endpoint is served by the Hive server container. Use the in-network form
#   for the router, because the router resolves names on the Docker network:
#     from the router container : http://server:3001/artifacts/v1/<TARGET_ID>
#     from your own shell       : http://localhost:8082/artifacts/v1/<TARGET_ID>
HIVE_TOKEN=
HIVE_CDN_ENDPOINT=
HIVE_CDN_KEY=
SECTION
} >> "$ENV_FILE"

chmod 600 "$ENV_FILE"
echo "wrote $ENV_FILE"
echo
if [[ -n "$CARRIED" ]]; then
  echo "Carried forward (pinned by the existing $PG_DATA_DIR):"
  echo "           $CARRIED"
  echo "Generated: CLICKHOUSE_PASSWORD REDIS_PASSWORD S3_ROOT_PASSWORD"
  echo "           CDN_AUTH_PRIVATE_KEY SUPERTOKENS_REFRESH_TOKEN_KEY"
  echo "           SUPERTOKENS_ACCESS_TOKEN_KEY"
  echo
  echo "ClickHouse, Redis and VersityGW re-read their credentials from the"
  echo "environment on every container start, so those rotate cleanly; only"
  echo "PostgreSQL is fixed at initdb. Recreate them to pick the new ones up:"
  echo "  docker compose -f docker-compose.yml -f docker-compose.console.yml up -d"
else
  echo "Generated: POSTGRES_PASSWORD CLICKHOUSE_PASSWORD REDIS_PASSWORD"
  echo "           S3_ROOT_PASSWORD HIVE_ENCRYPTION_SECRET CDN_AUTH_PRIVATE_KEY"
  echo "           SUPERTOKENS_REFRESH_TOKEN_KEY SUPERTOKENS_ACCESS_TOKEN_KEY"
fi
echo
echo "Still blank, filled in from the Console UI after first login:"
echo "           HIVE_TOKEN HIVE_CDN_ENDPOINT HIVE_CDN_KEY"
