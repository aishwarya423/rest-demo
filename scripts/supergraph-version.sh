#!/usr/bin/env bash
# ===========================================================================
# supergraph-version.sh — what the CDN publishes, and what each runtime serves
# ===========================================================================
# This is the instrumentation the runtimes do not give you.
#
# [Verified, Hive Router 0.3.16] The router has NO endpoint that reports the
# supergraph it has loaded. /health and /readiness answer an empty 200; every
# other path, /version and /metrics included, returns the router's landing
# page. There is nothing to read a version out of, so do not go looking for
# one again. Hive Gateway 2.15.10 is the same: it logs the CDN endpoint at
# startup and exposes no version route.
#
# So the question "is this runtime serving the latest supergraph?" is answered
# by comparing schemas, in three layers, strongest first:
#
#   1. REGISTRY IDENTITY  the CDN answers every artifact request with
#                         `x-hive-schema-version-id`, the registry's own UUID
#                         for the composed version, plus an `etag` content
#                         hash. This is the authoritative version number.
#   2. CONTENT CHECKSUM   sha256 of each artifact body as served.
#   3. RUNTIME AGREEMENT  introspect the runtime, canonicalise both its schema
#                         and the CDN's `sdl` artifact through graphql-js, and
#                         compare. Equal fingerprints mean the runtime is
#                         serving exactly the API the CDN is publishing.
#
# Layer 3 is the one that proves delivery. 1 and 2 only describe the artifact.
#
# USAGE
#   scripts/supergraph-version.sh                 report on every running runtime
#   scripts/supergraph-version.sh --require hive-router-registry
#                                                 exit 1 unless that one matches
#   scripts/supergraph-version.sh --diff hive-router
#                                                 print the canonical SDL diff
#   scripts/supergraph-version.sh --json          machine-readable summary
#
# Exit code: 0 when every CDN-sourced runtime that is running matches the CDN.
# A file-sourced runtime that differs is reported, not failed — that is the
# normal state between a registry publish and a local recompose.
# ===========================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POC="$(cd "$HERE/.." && pwd)/hive-router-poc"
ENV_FILE="$POC/.env"
COMPOSE=(docker compose -f "$POC/docker-compose.yml" -f "$POC/docker-compose.console.yml")

CURL_IMAGE="${CURL_IMAGE:-curlimages/curl:8.11.1}"
FP_IMAGE="${FP_IMAGE:-hive-router-poc-supergraph-compose}"
HIVE_NETWORK="${HIVE_NETWORK:-hive}"

REQUIRE=""
DIFF_TARGET=""
AS_JSON=0
EXTRA_URLS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --require) REQUIRE="${2:-}"; shift 2 ;;
    --diff)    DIFF_TARGET="${2:-}"; shift 2 ;;
    --json)    AS_JSON=1; shift ;;
    --url)     EXTRA_URLS+=("${2:-}"); shift 2 ;;
    -h|--help) sed -n '2,40p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# --- scratch -------------------------------------------------------------
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say() { [[ $AS_JSON -eq 1 ]] || echo "$@"; }

env_val() {
  [[ -f "$ENV_FILE" ]] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1 | sed "s/^'//; s/'$//"
  return 0
}

CDN_ENDPOINT="$(env_val HIVE_CDN_ENDPOINT)"
CDN_KEY="$(env_val HIVE_CDN_KEY)"

if [[ -z "$CDN_ENDPOINT" || -z "$CDN_KEY" || "$CDN_ENDPOINT" == UNSET-* ]]; then
  echo "HIVE_CDN_ENDPOINT / HIVE_CDN_KEY are not set in $ENV_FILE." >&2
  echo "Create a CDN access token: README 'Create a CDN access token'." >&2
  exit 2
fi

# --- 1 + 2: the artifact, as the CDN serves it ---------------------------
# curl runs in a container on the Hive network because HIVE_CDN_ENDPOINT is
# the IN-NETWORK address (server:3001). The localhost:8082 form only works
# from your shell, and hard-coding a rewrite here would break the moment the
# endpoint changes.
# Headers and body are fetched in SEPARATE calls on purpose. curl's -D/-o
# write inside the container, where $WORK does not exist, and reassembling a
# single `-i` response with awk appends a newline the server never sent — the
# sha256 then differs from the artifact by one byte, which is exactly the kind
# of quiet wrongness a checksum is supposed to catch.
cdn_curl() {
  docker run --rm --network "$HIVE_NETWORK" "$CURL_IMAGE" \
    -sS -H "X-Hive-CDN-Key: $CDN_KEY" "$@"
}

fetch_artifact() {
  local artifact="$1" out="$2"
  cdn_curl -D - -o /dev/null "$CDN_ENDPOINT/$artifact" > "$out.headers" || return 1
  grep -q '^HTTP/[0-9.]* 2' "$out.headers" || return 1
  cdn_curl -o - "$CDN_ENDPOINT/$artifact" > "$out.body" || return 1
  return 0
}

header_of() { sed -n "s/^$2: //Ip" "$1.headers" | tr -d '\r' | tail -n1; }
sha_of()    { shasum -a 256 < "$1" | cut -d' ' -f1; }
bytes_of()  { wc -c < "$1" | tr -d ' '; }

for art in supergraph sdl; do
  if ! fetch_artifact "$art" "$WORK/$art" 2>"$WORK/$art.err"; then
    echo "Failed to fetch the '$art' artifact from the CDN." >&2
    sed 's/^/  /' "$WORK/$art.err" >&2
    echo "  Check HIVE_CDN_ENDPOINT ends with the TARGET UUID, not its name." >&2
    exit 1
  fi
done

VERSION_ID="$(header_of "$WORK/supergraph" x-hive-schema-version-id)"
ETAG="$(header_of "$WORK/supergraph" etag)"
SUPERGRAPH_SHA="$(sha_of "$WORK/supergraph.body")"
SUPERGRAPH_BYTES="$(bytes_of "$WORK/supergraph.body")"
SDL_SHA="$(sha_of "$WORK/sdl.body")"
SDL_BYTES="$(bytes_of "$WORK/sdl.body")"

# --- 3: canonical fingerprints -------------------------------------------
# The helper is mounted at /app/fp, INSIDE the image's install root. Mounting
# it at /fp instead makes `import { buildSchema } from "graphql"` fail with
# ERR_MODULE_NOT_FOUND, because Node resolves bare specifiers by walking up
# from the importing file and /app/node_modules is then out of that path.
fingerprint() {
  local file="$1" flag="${2:-}"
  docker run --rm \
    -v "$HERE/lib:/app/fp:ro" \
    -v "$WORK:/w" \
    "$FP_IMAGE" node /app/fp/schema-fingerprint.mjs "/w/$(basename "$file")" $flag
}

cp "$WORK/sdl.body" "$WORK/cdn.graphql"
CDN_FP_LINE="$(fingerprint "$WORK/cdn.graphql")"
CDN_FP="${CDN_FP_LINE%% *}"

say "CDN artifact"
say "  endpoint            $CDN_ENDPOINT"
say "  schema version id   ${VERSION_ID:-<none>}"
say "  etag                ${ETAG:-<none>}"
say "  supergraph          $SUPERGRAPH_BYTES bytes  sha256 ${SUPERGRAPH_SHA:0:16}…"
say "  api sdl             $SDL_BYTES bytes  sha256 ${SDL_SHA:0:16}…"
say "  api fingerprint     $CDN_FP_LINE"
say ""

# --- the runtimes --------------------------------------------------------
# service | in-network graphql url | supergraph source
RUNTIME_TABLE="
hive-router|http://hive-router:4000/graphql|file
hive-router-registry|http://hive-router-registry:4000/graphql|cdn
hive-gateway-cdn|http://hive-gateway-cdn:4000/graphql|cdn
gateway-router-runtime|http://gateway-router-runtime:4010/graphql|file
"

running() {
  local svc="$1" cid
  cid="$("${COMPOSE[@]}" --profile registry --profile gateway-cdn --profile compare ps -q "$svc" </dev/null 2>/dev/null || true)"
  [[ -n "$cid" ]] && [[ "$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null)" == "true" ]]
}

introspect_to() {
  local url="$1" out="$2"
  # </dev/null matters: `docker compose run` reads stdin even with -T, and
  # without this it swallows the rest of the runtime table the caller is
  # looping over, so only the first runtime ever gets probed.
  "${COMPOSE[@]}" run --rm --no-deps -T --entrypoint hive hive-cli \
    introspect "$url" </dev/null 2>"$out.err" | grep -v '^ *Container ' > "$out" || return 1
  [[ -s "$out" ]]
}

say "Runtimes"
printf_row() { [[ $AS_JSON -eq 1 ]] || printf '  %-24s %-8s %-12s %s\n' "$1" "$2" "$3" "$4"; }
printf_row "service" "source" "fingerprint" "verdict"
printf_row "------------------------" "--------" "------------" "-------"

FAILED=0
JSON_RUNTIMES=""

probe() {
  local label="$1" url="$2" source="$3"
  local out="$WORK/rt.graphql" fp="" verdict=""
  if ! introspect_to "$url" "$out"; then
    verdict="INTROSPECTION FAILED"
    printf_row "$label" "$source" "-" "$verdict"
    [[ "$source" == "cdn" ]] && FAILED=1
    [[ "$label" == "$REQUIRE" ]] && FAILED=1
    JSON_RUNTIMES="$JSON_RUNTIMES{\"service\":\"$label\",\"source\":\"$source\",\"fingerprint\":null,\"matches_cdn\":false},"
    return 0
  fi
  cp "$out" "$WORK/runtime.graphql"
  local line
  line="$(fingerprint "$WORK/runtime.graphql")"
  fp="${line%% *}"
  if [[ "$fp" == "$CDN_FP" ]]; then
    verdict="MATCHES CDN"
  else
    verdict="DIFFERS from CDN"
    if [[ "$source" == "cdn" ]]; then
      FAILED=1
      verdict="$verdict  <-- should not happen for a CDN-sourced runtime"
    else
      verdict="$verdict  (expected until supergraph-compose reruns)"
    fi
    [[ "$label" == "$REQUIRE" ]] && FAILED=1
  fi
  printf_row "$label" "$source" "${fp:0:12}…" "$verdict"
  JSON_RUNTIMES="$JSON_RUNTIMES{\"service\":\"$label\",\"source\":\"$source\",\"fingerprint\":\"$fp\",\"matches_cdn\":$([[ "$fp" == "$CDN_FP" ]] && echo true || echo false)},"

  if [[ -n "$DIFF_TARGET" && "$label" == "$DIFF_TARGET" ]]; then
    fingerprint "$WORK/cdn.graphql" --print > "$WORK/cdn.canonical"
    fingerprint "$WORK/runtime.graphql" --print > "$WORK/runtime.canonical"
    say ""
    say "  --- canonical SDL diff: CDN (-) vs $label (+) ---"
    diff -u "$WORK/cdn.canonical" "$WORK/runtime.canonical" | sed 's/^/  /' || true
    say ""
  fi
}

# Plain word-splitting over the table rather than `read` from a here-string,
# so nothing in probe() can disturb the iteration.
for row in $RUNTIME_TABLE; do
  svc="${row%%|*}"
  rest="${row#*|}"
  url="${rest%%|*}"
  source="${rest##*|}"
  [[ -z "$svc" ]] && continue
  running "$svc" || continue
  probe "$svc" "$url" "$source"
done

for u in ${EXTRA_URLS+"${EXTRA_URLS[@]}"}; do
  probe "$u" "$u" "unknown"
done

if [[ $AS_JSON -eq 1 ]]; then
  printf '{"cdn":{"endpoint":"%s","schema_version_id":"%s","etag":%s,"supergraph_sha256":"%s","sdl_sha256":"%s","api_fingerprint":"%s"},"runtimes":[%s]}\n' \
    "$CDN_ENDPOINT" "$VERSION_ID" "\"${ETAG//\"/\\\"}\"" "$SUPERGRAPH_SHA" "$SDL_SHA" "$CDN_FP" "${JSON_RUNTIMES%,}"
fi

say ""
if [[ $FAILED -eq 0 ]]; then
  say "Every CDN-sourced runtime is serving the published supergraph."
else
  say "At least one runtime is NOT serving the published supergraph (see above)."
fi
exit $FAILED
