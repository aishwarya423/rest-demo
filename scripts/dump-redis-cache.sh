#!/usr/bin/env bash
# =============================================================================
# Dump the Grafbase gateway's Redis cache to a file so you can inspect it.
#
# Shows, for every matching key: the key name, its TYPE, its TTL, and its VALUE
# (operation-cache = query plans, entity-cache = subgraph responses). Also prints
# a count-by-prefix summary (e.g. how many insurance-entitycache* keys exist).
#
# Usage:
#   scripts/dump-redis-cache.sh [PATTERN] [OUTFILE]
#     PATTERN   key glob (default '*'). e.g. 'insurance-entitycache*'
#     OUTFILE   output file (default redis-cache-dump-<timestamp>.txt)
#
# Connection (env overrides):
#   REDIS_HOST        default 127.0.0.1
#   REDIS_PORT        default 6379
#   REDIS_CONTAINER   if set, run the CLI INSIDE this docker container instead
#                     of connecting over the network (handy when the CLI isn't
#                     installed on the host). Find it with: docker ps
#   REDIS_CLI         CLI binary (default redis-cli). Use 'valkey-cli' when the
#                     backend is Valkey (the Valkey image ships valkey-cli).
#
# Examples:
#   scripts/dump-redis-cache.sh
#   scripts/dump-redis-cache.sh 'insurance-entitycache*' entity-keys.txt
#   REDIS_CONTAINER=redis-cache scripts/dump-redis-cache.sh
#   REDIS_CONTAINER=<valkey container> REDIS_CLI=valkey-cli scripts/dump-redis-cache.sh
# =============================================================================
set -euo pipefail

PATTERN="${1:-*}"
OUT="${2:-redis-cache-dump-$(date +%Y%m%d-%H%M%S).txt}"
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.gateway.yml}"
CLI="${REDIS_CLI:-}"                # optional override: redis-cli or valkey-cli
CONTAINER="${REDIS_CONTAINER:-}"    # optional explicit container

# NOTE: no `docker exec -i` — an interactive exec would swallow stdin and break
# the key loop below.
#
# Resolution order (so `scripts/dump-redis-cache.sh` "just works" when the Docker
# stack is up, on Redis OR Valkey):
#   1. explicit REDIS_CONTAINER, else
#   2. a redis-cli/valkey-cli on the host (PATH), else
#   3. auto-detect the running compose cache container (`redis` service).
# The in-container CLI is auto-detected (redis-cli vs valkey-cli) unless REDIS_CLI is set.

if [ -z "$CONTAINER" ]; then
  # 2) host CLI?
  hostcli=""
  for c in "$CLI" redis-cli valkey-cli; do
    if [ -n "$c" ] && command -v "$c" >/dev/null 2>&1; then hostcli="$c"; break; fi
  done
  if [ -n "$hostcli" ]; then
    CLI="$hostcli"
    rcli() { "$CLI" -h "$REDIS_HOST" -p "$REDIS_PORT" "$@"; }
    SOURCE="$REDIS_HOST:$REDIS_PORT ($CLI)"
  elif command -v docker >/dev/null 2>&1 && [ -f "$COMPOSE_FILE" ]; then
    # 3) auto-detect the running compose cache container
    CONTAINER="$(docker compose -f "$COMPOSE_FILE" ps -q redis 2>/dev/null | head -1 || true)"
  fi
fi

if [ -z "${SOURCE:-}" ]; then
  if [ -z "$CONTAINER" ]; then
    echo "ERROR: no cache found to inspect." >&2
    echo "  - no redis-cli/valkey-cli on PATH, and" >&2
    echo "  - no running '$COMPOSE_FILE' cache container." >&2
    echo "Fix one of:" >&2
    echo "  * start the Docker stack:  docker compose -f $COMPOSE_FILE up -d" >&2
    echo "  * or set REDIS_CONTAINER=<name>  (see 'docker ps';" >&2
    echo "    add REDIS_CLI=valkey-cli if the backend is Valkey)" >&2
    exit 1
  fi
  # auto-detect the CLI available inside the container (unless overridden)
  if [ -z "$CLI" ]; then
    if docker exec "$CONTAINER" sh -c 'command -v redis-cli' >/dev/null 2>&1; then CLI="redis-cli"
    elif docker exec "$CONTAINER" sh -c 'command -v valkey-cli' >/dev/null 2>&1; then CLI="valkey-cli"
    else CLI="redis-cli"; fi
  fi
  cname="$(docker inspect -f '{{.Name}}' "$CONTAINER" 2>/dev/null | sed 's|^/||' || true)"
  rcli() { docker exec "$CONTAINER" "$CLI" "$@"; }
  SOURCE="container=${cname:-$CONTAINER} ($CLI)"
fi

# Connectivity check.
if ! rcli PING >/dev/null 2>&1; then
  echo "ERROR: cannot reach Redis ($SOURCE)." >&2
  echo "Is Redis running and (for host mode) the port published?" >&2
  exit 1
fi

strip_cr() { tr -d '\r'; }

# Capture the key list ONCE so the per-key commands below can't consume it.
KEYS="$(rcli --scan --pattern "$PATTERN" | strip_cr | sort)"
KEYCOUNT="$(printf '%s\n' "$KEYS" | grep -c . || true)"

{
  echo "# Redis cache dump"
  echo "# time    : $(date)"
  echo "# source  : $SOURCE"
  echo "# pattern : $PATTERN"
  echo "# dbsize  : $(rcli DBSIZE | strip_cr)"
  echo

  echo "## key counts by prefix"
  # collapse trailing hashes so opcache/entitycache families group together
  printf '%s\n' "$KEYS" | grep -c . >/dev/null 2>&1 && \
  printf '%s\n' "$KEYS" \
    | sed -E 's/\.blake3\..*$/.<hash>/; s/-[0-9a-f]{8,}$/-<hash>/' \
    | sort | uniq -c | sort -rn
  echo

  echo "## keys (KEY | TYPE | TTL | VALUE)"
  if [ "$KEYCOUNT" -eq 0 ]; then
    echo "(no keys match pattern '$PATTERN')"
  fi
  printf '%s\n' "$KEYS" | while IFS= read -r key; do
    [ -z "$key" ] && continue
    ktype="$(rcli TYPE "$key" | strip_cr)"
    kttl="$(rcli TTL "$key" | strip_cr)"   # -1 = no expiry, -2 = missing
    echo "----------------------------------------------------------------------"
    echo "KEY : $key"
    echo "TYPE: $ktype   TTL: ${kttl}s"
    echo "VALUE:"
    case "$ktype" in
      string) rcli --no-raw GET "$key" ;;
      hash)   rcli --no-raw HGETALL "$key" ;;
      list)   rcli --no-raw LRANGE "$key" 0 -1 ;;
      set)    rcli --no-raw SMEMBERS "$key" ;;
      zset)   rcli --no-raw ZRANGE "$key" 0 -1 WITHSCORES ;;
      *)      echo "(type '$ktype' not dumped)" ;;
    esac
    echo
  done
} > "$OUT"

echo "Wrote Redis cache dump -> $OUT"
echo "Matched $KEYCOUNT key(s) for pattern '$PATTERN' ($SOURCE)."
echo "Note: cache VALUES are serialized/compressed blobs — the readable signal is the KEY names, TYPE and TTL."
