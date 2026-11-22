// ===========================================================================
// Canonical fingerprint of a GraphQL schema document.
// ===========================================================================
// WHY THIS EXISTS
//
// Hive Router 0.3.16 exposes no endpoint that reports which supergraph it has
// loaded. `/health` and `/readiness` return an empty 200; every other path
// (including /version and /metrics) returns the router's landing page, so
// there is nothing to read a version out of. Verified by probing the running
// container -- do not go looking for a version endpoint again.
//
// So "is this runtime serving the schema the CDN is publishing?" has to be
// answered by comparing the schemas themselves. The two sides are printed by
// different code paths:
//
//   CDN     GET <endpoint>/sdl        -- the API schema, printed by Hive
//   runtime hive introspect <url>     -- printed from an introspection result
//
// Those differ in declaration order and in incidental formatting even when
// the schema is identical, so a byte comparison is useless and a line-based
// normaliser gets descriptions wrong (tried: triple-quoted one-liners such as
// `"""0 when not applicable"""` break any toggle-based parser).
//
// Running both sides through graphql-js -- parse, sort lexicographically,
// print -- removes every incidental difference and leaves a form where equal
// bytes really do mean equal schemas. That is what makes the hash printed
// here safe to compare across the CDN artifact and a live runtime.
//
// Usage:  node schema-fingerprint.mjs <file.graphql> [--print]
// Output: "<sha256>  <bytes> bytes  <types> types  <fields> fields"
//         --print also writes the canonical SDL to stdout, for diffing.
// ===========================================================================
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  buildSchema,
  printSchema,
  lexicographicSortSchema,
  isObjectType,
  isInterfaceType,
} from "graphql";

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error("usage: node schema-fingerprint.mjs <file.graphql> [--print]");
  process.exit(2);
}

const source = readFileSync(file, "utf8");

// assumeValidSDL: the API schema served by the CDN references no federation
// directives, but an operator may point this at a raw subgraph SDL as well.
// Validation is not the job here; canonicalisation is.
const schema = buildSchema(source, { assumeValidSDL: true });
const canonical = printSchema(lexicographicSortSchema(schema));

const sha = createHash("sha256").update(canonical).digest("hex");

let types = 0;
let fields = 0;
for (const [name, type] of Object.entries(schema.getTypeMap())) {
  if (name.startsWith("__")) continue;
  types += 1;
  if (isObjectType(type) || isInterfaceType(type)) {
    fields += Object.keys(type.getFields()).length;
  }
}

if (flags.includes("--print")) {
  process.stdout.write(canonical);
} else {
  console.log(
    `${sha}  ${Buffer.byteLength(canonical)} bytes  ${types} types  ${fields} fields`,
  );
}
