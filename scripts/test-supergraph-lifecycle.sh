#!/usr/bin/env bash
# ===========================================================================
# test-supergraph-lifecycle.sh — registry -> CDN -> runtime, end to end
# ===========================================================================
# Exercises the whole delivery path on the running stack by making a real
# schema change and following it all the way to a client query:
#
#   edit a subgraph -> compose locally -> inspect the SDL -> hive schema:check
#   -> hive schema:publish -> registry composes -> CDN serves a NEW version id
#   -> the CDN-sourced router and gateway hot-reload -> query the new field
#   -> the FILE-sourced router is shown to still be on the old schema
#   -> restart it -> it catches up -> revert and republish
#
# WHY THE ORDER IS WHAT IT IS
#
# The interesting step is deliberately placed between publish and restart.
# supergraph-compose writes the new supergraph into the shared volume, but the
# router on :4000 only reads that file at startup, so for a moment :4100 and
# :4110 serve the new field while :4000 does not. That window is the clearest
# demonstration of the difference between a file-sourced and a registry-sourced
# runtime, and the test asserts it rather than papering over it.
#
# WHAT IT MUTATES
#   - hive-router-poc/subgraphs/src/accounts.mjs   (restored at the end unless --keep)
#   - the accounts-subgraph image and container    (rebuilt)
#   - the `supergraph` docker volume               (recomposed)
#   - the Hive registry                            (new schema versions — these
#     are append-only history and are NOT removed; a revert is a republish)
#
# USAGE
#   scripts/test-supergraph-lifecycle.sh              full run, then revert
#   scripts/test-supergraph-lifecycle.sh --keep       leave the new field live
#   scripts/test-supergraph-lifecycle.sh --dry-run    stop after schema:check
#   scripts/test-supergraph-lifecycle.sh --skip-gateway
#
# Exit code 0 only if every stage passed.
# ===========================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
POC="$REPO/hive-router-poc"
ENV_FILE="$POC/.env"
SUBGRAPH_FILE="$POC/subgraphs/src/accounts.mjs"

COMPOSE=(docker compose -f "$POC/docker-compose.yml" -f "$POC/docker-compose.console.yml")
CURL_IMAGE="${CURL_IMAGE:-curlimages/curl:8.11.1}"
HIVE_NETWORK="${HIVE_NETWORK:-hive}"

FIELD="${FIELD:-holdingsCount}"
KEEP=0
DRY_RUN=0
SKIP_GATEWAY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --field) FIELD="${2:?}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --skip-gateway) SKIP_GATEWAY=1; shift ;;
    -h|--help) sed -n '2,36p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# --------------------------------------------------------------- plumbing
PASS=0; FAIL=0; STAGE=0
BACKUP=""
WORK="$(mktemp -d)"

cleanup_tmp() { rm -rf "$WORK"; }
trap cleanup_tmp EXIT

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
stage() { STAGE=$((STAGE+1)); echo; bold "── $STAGE. $*"; }
ok()    { PASS=$((PASS+1)); printf '   \033[32mPASS\033[0m  %s\n' "$*"; }
bad()   { FAIL=$((FAIL+1)); printf '   \033[31mFAIL\033[0m  %s\n' "$*"; }
info()  { printf '         %s\n' "$*"; }

die() {
  echo
  printf '\033[31mAborted: %s\033[0m\n' "$*" >&2
  restore_source
  exit 1
}

env_val() {
  [[ -f "$ENV_FILE" ]] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1 | sed "s/^'//; s/'\$//"
  return 0
}

CDN_ENDPOINT="$(env_val HIVE_CDN_ENDPOINT)"
CDN_KEY="$(env_val HIVE_CDN_KEY)"

cdn_header() {
  docker run --rm --network "$HIVE_NETWORK" "$CURL_IMAGE" \
    -sS -D - -o /dev/null -H "X-Hive-CDN-Key: $CDN_KEY" \
    "$CDN_ENDPOINT/${2:-supergraph}" </dev/null 2>/dev/null \
    | sed -n "s/^$1: //Ip" | tr -d '\r' | tail -n1
}

cdn_body() {
  docker run --rm --network "$HIVE_NETWORK" "$CURL_IMAGE" \
    -sS -o - -H "X-Hive-CDN-Key: $CDN_KEY" \
    "$CDN_ENDPOINT/${1:-supergraph}" </dev/null 2>/dev/null
}

# Query a runtime through its published host port.
gql() {
  local port="$1" query="$2"
  curl -sS "http://localhost:$port/graphql" \
    -H 'content-type: application/json' \
    --data-binary "$(python3 - "$query" <<'PY'
import json,sys
print(json.dumps({"query": sys.argv[1]}))
PY
)" 2>/dev/null
}

runtime_has_field() {
  local port="$1"
  gql "$port" "query { __type(name: \"Account\") { fields { name } } }" \
    | grep -q "\"$FIELD\""
}

restore_source() {
  if [[ -n "$BACKUP" && -f "$BACKUP" ]]; then
    cp "$BACKUP" "$SUBGRAPH_FILE"
    echo "   restored $SUBGRAPH_FILE"
  fi
}

# --build is NOT optional. compose/Dockerfile COPYs subgraphs/src into the
# composer image, which is what guarantees the published SDL and the running
# schema cannot drift. The flip side is that editing a subgraph module and
# re-running the composer WITHOUT a rebuild composes the OLD modules, exits 0,
# and writes a supergraph missing the change. Verified the hard way.
recompose() {
  "${COMPOSE[@]}" run --rm --no-deps --build -T supergraph-compose </dev/null >"$WORK/compose.log" 2>&1
}

# ======================================================================
stage "Preflight"
# ======================================================================
for v in HIVE_TOKEN HIVE_TARGET HIVE_CDN_ENDPOINT HIVE_CDN_KEY; do
  if [[ -z "$(env_val "$v")" ]]; then
    die "$v is not set in $ENV_FILE (see the README setup steps)"
  fi
done
ok ".env has HIVE_TOKEN, HIVE_TARGET, HIVE_CDN_ENDPOINT, HIVE_CDN_KEY"

if [[ "$CDN_ENDPOINT" != */artifacts/v1/????????-????-????-????-???????????? ]]; then
  bad "HIVE_CDN_ENDPOINT does not end with a target UUID: $CDN_ENDPOINT"
  info "the artifact route keys on the target's UUID, not its name, and"
  info "answers 403 (not 404) for a name — so the key looks guilty instead"
  die "fix HIVE_CDN_ENDPOINT first"
fi
ok "HIVE_CDN_ENDPOINT ends with a target UUID"

for svc in server accounts-subgraph hive-router hive-router-registry; do
  cid="$("${COMPOSE[@]}" --profile registry ps -q "$svc" </dev/null 2>/dev/null)"
  if [[ -z "$cid" ]] || [[ "$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null)" != "true" ]]; then
    die "$svc is not running — start the stack, including --profile registry"
  fi
done
ok "server, accounts-subgraph, hive-router and hive-router-registry are running"

BASE_VERSION="$(cdn_header x-hive-schema-version-id)"
[[ -n "$BASE_VERSION" ]] || die "the CDN did not return x-hive-schema-version-id"
ok "CDN reachable, current schema version id ${BASE_VERSION}"

if grep -q "$FIELD" "$SUBGRAPH_FILE"; then
  die "the accounts subgraph already declares '$FIELD' — pass --field <other>"
fi
ok "'$FIELD' is not yet in the accounts subgraph"

for port in 4000 4100; do
  if runtime_has_field "$port"; then
    die ":$port already serves Account.$FIELD — nothing to prove"
  fi
done
ok "neither :4000 nor :4100 serves Account.$FIELD yet"

# ======================================================================
stage "Add a field to the accounts subgraph"
# ======================================================================
BACKUP="$WORK/accounts.mjs.orig"
cp "$SUBGRAPH_FILE" "$BACKUP"

python3 - "$SUBGRAPH_FILE" "$FIELD" <<'PY' || exit 1
import sys, pathlib
path, field = sys.argv[1], sys.argv[2]
p = pathlib.Path(path)
s = p.read_text()

# Insert into the Account type, right after contributionRate, with a
# description naming the REST route the data comes from — the house rule in
# references/federation.md.
anchor = '    "Percent; 0 when not contributing"\n    contributionRate: Float!\n'
if anchor not in s:
    sys.exit("anchor for the Account field not found in %s" % path)
s = s.replace(
    anchor,
    anchor
    + '    "Number of fund holdings. Derived from GET /accounts/{id}; no new REST call."\n'
    + '    %s: Int!\n' % field,
    1,
)

# Resolver. Derived from the payload the entity resolver already fetched, so
# this adds a field without adding an upstream call — the REST services are
# read-only in this repo.
anchor = """    Account: {
      // Entity resolver."""
if anchor not in s:
    sys.exit("anchor for the Account resolver not found in %s" % path)
s = s.replace(
    anchor,
    """    Account: {
      // Added by scripts/test-supergraph-lifecycle.sh. Derived from the REST
      // payload the account query already returned, so it costs no extra call.
      %s: (account) => (account.fundHoldings || []).length,

      // Entity resolver.""" % field,
    1,
)
p.write_text(s)
print("   added Account.%s to %s" % (field, path))
PY

grep -q "$FIELD" "$SUBGRAPH_FILE" && ok "Account.$FIELD added to the SDL and resolvers" \
  || { bad "edit did not apply"; die "could not add the field"; }

info "rebuilding accounts-subgraph…"
if "${COMPOSE[@]}" up -d --build --no-deps accounts-subgraph </dev/null >"$WORK/build.log" 2>&1; then
  ok "accounts-subgraph rebuilt and restarted"
else
  tail -20 "$WORK/build.log"
  die "accounts-subgraph failed to rebuild"
fi

# The subgraph serves its own SDL through the federation _service field; that
# is the real source of truth for what was deployed.
for _ in $(seq 1 20); do
  if curl -sS http://localhost:4001/graphql -H 'content-type: application/json' \
      -d '{"query":"{ _service { sdl } }"}' 2>/dev/null | grep -q "$FIELD"; then
    break
  fi
  sleep 1
done
if curl -sS http://localhost:4001/graphql -H 'content-type: application/json' \
    -d '{"query":"{ _service { sdl } }"}' 2>/dev/null | grep -q "$FIELD"; then
  ok "the running subgraph reports $FIELD in _service { sdl }"
else
  die "the rebuilt subgraph does not report the new field"
fi

# ======================================================================
stage "Compose the supergraph locally and inspect the SDL"
# ======================================================================
if recompose; then
  ok "supergraph-compose exited 0"
else
  tail -20 "$WORK/compose.log"
  die "local composition failed — the change does not compose"
fi

read_volume() {
  docker run --rm -v hive-router-poc_supergraph:/v alpine cat "/v/$1" 2>/dev/null
}

if read_volume "sdl/accounts.graphql" | grep -q "$FIELD"; then
  ok "sdl/accounts.graphql in the shared volume contains $FIELD"
else
  die "the composed accounts SDL does not contain the new field"
fi

if read_volume "supergraph.graphql" | grep -q "$FIELD"; then
  ok "supergraph.graphql in the shared volume contains $FIELD"
else
  die "the composed supergraph does not contain the new field"
fi

info "$(read_volume supergraph.graphql | grep -c '' ) lines of supergraph SDL, $(read_volume supergraph.graphql | wc -c | tr -d ' ') bytes"
info "the join directive that proves which subgraph owns it:"
read_volume "supergraph.graphql" | grep -A1 "$FIELD" | head -2 | sed 's/^/           /'

# ======================================================================
stage "Hive schema check (the CI gate)"
# ======================================================================
if "${COMPOSE[@]}" run --rm -T hive-cli hive/check.sh </dev/null >"$WORK/check.log" 2>&1; then
  ok "all three subgraphs check clean — the change is additive, not breaking"
else
  bad "schema:check reported problems"
  grep -v '^ *Container ' "$WORK/check.log" | tail -30 | sed 's/^/         /'
  die "fix the schema check before publishing"
fi
grep -o 'http://localhost:8080/[^ ]*checks/[a-f0-9-]*' "$WORK/check.log" | tail -1 \
  | sed 's|^|         full report: |'

if [[ $DRY_RUN -eq 1 ]]; then
  echo
  bold "--dry-run: stopping before publish."
  restore_source
  info "The source file is restored, but the subgraph IMAGE and the supergraph"
  info "volume still hold the field. Undo both (note --build on each, or they"
  info "rebuild from nothing and from stale modules respectively):"
  info "  docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml up -d --build accounts-subgraph"
  info "  docker compose -f hive-router-poc/docker-compose.yml -f hive-router-poc/docker-compose.console.yml run --rm --build --no-deps supergraph-compose"
  exit $(( FAIL > 0 ))
fi

# ======================================================================
stage "Publish to the registry"
# ======================================================================
if "${COMPOSE[@]}" run --rm -T hive-cli hive/publish.sh </dev/null >"$WORK/publish.log" 2>&1; then
  ok "all three subgraphs published"
else
  bad "publish failed"
  grep -v '^ *Container ' "$WORK/publish.log" | tail -30 | sed 's/^/         /'
  die "publish failed"
fi

# ======================================================================
stage "CDN serves a new version"
# ======================================================================
NEW_VERSION=""
for _ in $(seq 1 30); do
  NEW_VERSION="$(cdn_header x-hive-schema-version-id)"
  [[ -n "$NEW_VERSION" && "$NEW_VERSION" != "$BASE_VERSION" ]] && break
  sleep 2
done

if [[ -n "$NEW_VERSION" && "$NEW_VERSION" != "$BASE_VERSION" ]]; then
  ok "x-hive-schema-version-id changed"
  info "was $BASE_VERSION"
  info "now $NEW_VERSION"
else
  bad "the CDN still reports $BASE_VERSION"
  die "the registry did not publish a new composed version"
fi

if cdn_body supergraph | grep -q "$FIELD"; then
  ok "the CDN supergraph artifact contains $FIELD"
else
  die "the new artifact does not contain the field"
fi
info "etag $(cdn_header etag)"
info "sha256 $(cdn_body supergraph | shasum -a 256 | cut -d' ' -f1)"

# ======================================================================
stage "The registry-sourced router hot-reloads (:4100)"
# ======================================================================
RELOADED=0
for i in $(seq 1 30); do
  if runtime_has_field 4100; then RELOADED=$i; break; fi
  sleep 2
done
if [[ $RELOADED -gt 0 ]]; then
  ok "Account.$FIELD appeared on :4100 after ~$((RELOADED * 2))s, with no restart"
else
  bad ":4100 never picked up the new schema"
  "${COMPOSE[@]}" --profile registry logs --tail 15 hive-router-registry </dev/null 2>&1 | sed 's/^/         /'
fi

RESULT="$(gql 4100 "query { account(id: \"acct-1001\") { holderName $FIELD } }")"
if echo "$RESULT" | grep -q '"holderName"' && ! echo "$RESULT" | grep -q '"errors"'; then
  ok ":4100 answers the new field with data: $(echo "$RESULT" | head -c 160)"
else
  bad ":4100 returned an error: $(echo "$RESULT" | head -c 300)"
fi

# ======================================================================
stage "The file-sourced router has NOT moved (:4000)"
# ======================================================================
# This is the point of the whole exercise: the volume already holds the new
# supergraph, but :4000 read it at startup and has no reason to re-read it.
if runtime_has_field 4000; then
  bad ":4000 already serves $FIELD — expected it to be stale until restarted"
  info "that happens if hive-router was recreated by an earlier step"
else
  ok ":4000 is still serving the previous supergraph, as a file source should"
  info "same subgraphs, same volume, different delivery mechanism"
fi

# ======================================================================
stage "Restart the file-sourced router and it catches up (:4000)"
# ======================================================================
if "${COMPOSE[@]}" restart hive-router </dev/null >/dev/null 2>&1; then
  for _ in $(seq 1 20); do runtime_has_field 4000 && break; sleep 1; done
  if runtime_has_field 4000; then
    ok ":4000 serves $FIELD after a restart"
  else
    bad ":4000 still does not serve the field after a restart"
  fi
else
  bad "could not restart hive-router"
fi

RESULT="$(gql 4000 "query { account(id: \"acct-1001\") { holderName $FIELD } }")"
if echo "$RESULT" | grep -q '"holderName"' && ! echo "$RESULT" | grep -q '"errors"'; then
  ok ":4000 answers the new field with data: $(echo "$RESULT" | head -c 160)"
else
  bad ":4000 returned an error: $(echo "$RESULT" | head -c 300)"
fi

# ======================================================================
if [[ $SKIP_GATEWAY -eq 0 ]]; then
stage "Hive Gateway, same CDN artifact (:4110)"
# ======================================================================
  if "${COMPOSE[@]}" --profile gateway-cdn up -d hive-gateway-cdn </dev/null >"$WORK/gw.log" 2>&1; then
    GW=0
    for i in $(seq 1 30); do
      if runtime_has_field 4110; then GW=$i; break; fi
      sleep 2
    done
    if [[ $GW -gt 0 ]]; then
      ok "Hive Gateway serves $FIELD from the same CDN endpoint"
      "${COMPOSE[@]}" --profile gateway-cdn logs hive-gateway-cdn </dev/null 2>&1 \
        | grep -m1 'Hive CDN' | sed 's/^.*INF/         INF/' || true
    else
      bad "Hive Gateway did not serve the field within 60s"
      tail -15 "$WORK/gw.log" | sed 's/^/         /'
    fi
    RESULT="$(gql 4110 "query { account(id: \"acct-1001\") { holderName $FIELD } }")"
    if echo "$RESULT" | grep -q '"holderName"' && ! echo "$RESULT" | grep -q '"errors"'; then
      ok ":4110 answers the new field with data"
    else
      bad ":4110 returned an error: $(echo "$RESULT" | head -c 300)"
    fi
  else
    bad "could not start hive-gateway-cdn"
    tail -15 "$WORK/gw.log" | sed 's/^/         /'
  fi
fi

# ======================================================================
stage "Version probe agrees"
# ======================================================================
if "$HERE/supergraph-version.sh" </dev/null | sed 's/^/         /'; then
  ok "every CDN-sourced runtime matches the CDN's canonical fingerprint"
else
  bad "the version probe reports a mismatch"
fi

# ======================================================================
if [[ $KEEP -eq 1 ]]; then
  echo
  bold "--keep: Account.$FIELD is left in place."
  info "to undo later: git checkout -- hive-router-poc/subgraphs/src/accounts.mjs"
  info "then rebuild, recompose, republish and restart hive-router."
  BACKUP=""
else
stage "Revert — restore the source and republish"
# ======================================================================
# The registry is append-only: removing a field means publishing the earlier
# schema again, which is exactly how a rollback works in production. The
# version history keeps both, by design.
  restore_source
  if "${COMPOSE[@]}" up -d --build --no-deps accounts-subgraph </dev/null >"$WORK/rebuild.log" 2>&1; then
    ok "accounts-subgraph rebuilt without the field"
  else
    bad "rebuild failed"; tail -10 "$WORK/rebuild.log" | sed 's/^/         /'
  fi
  if recompose; then ok "recomposed"; else bad "recompose failed"; fi
  if "${COMPOSE[@]}" run --rm -T hive-cli hive/publish.sh </dev/null >"$WORK/republish.log" 2>&1; then
    ok "republished the previous schema (rollback by republish)"
  else
    bad "republish failed"; grep -v '^ *Container ' "$WORK/republish.log" | tail -20 | sed 's/^/         /'
  fi
  "${COMPOSE[@]}" restart hive-router </dev/null >/dev/null 2>&1
  # :4110 is included when the gateway is up. It reloads SILENTLY — unlike the
  # router, Hive Gateway logs nothing when it swaps the supergraph — and it
  # lands a poll or two after the router, so a probe run straight after the
  # republish can legitimately still show the old fingerprint there.
  GW_UP=0
  if [[ $SKIP_GATEWAY -eq 0 ]]; then
    cid="$("${COMPOSE[@]}" --profile gateway-cdn ps -q hive-gateway-cdn </dev/null 2>/dev/null)"
    [[ -n "$cid" ]] && [[ "$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null)" == "true" ]] && GW_UP=1
  fi
  GONE=0
  for _ in $(seq 1 30); do
    if ! runtime_has_field 4100 && ! runtime_has_field 4000 \
       && { [[ $GW_UP -eq 0 ]] || ! runtime_has_field 4110; }; then
      GONE=1; break
    fi
    sleep 2
  done
  if [[ $GONE -eq 1 ]]; then
    ok "Account.$FIELD is gone from :4000, :4100$([[ $GW_UP -eq 1 ]] && echo ' and :4110')"
  else
    bad "the field is still present on at least one runtime"
  fi
  BACKUP=""
fi

# ======================================================================
echo
bold "────────────────────────────────────────────────────────"
bold " $PASS passed, $FAIL failed"
bold "────────────────────────────────────────────────────────"
exit $(( FAIL > 0 ))
