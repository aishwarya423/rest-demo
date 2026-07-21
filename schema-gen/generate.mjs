#!/usr/bin/env node
/**
 * generate.mjs — custom Swagger/OpenAPI -> GraphQL SDL scaffolder (zero dependencies).
 *
 * Reads each service's co-located openapi.json (components.schemas), emits
 * GraphQL type/enum definitions into schema-gen/generated/ (one file per
 * service, overwritten on every run), then composes:
 *
 *   manual/header.graphql        (hand-written @link + @restEndpoint block)
 * + generated/_shared.graphql    (custom scalars, generated)
 * + generated/<service>.types.graphql  (types + enums, generated)
 * + manual/federation.graphql    (hand-written Query fields, @rest wiring,
 *                                 cross-service joins via extend type)
 * = schema-gen/schema.generated.graphql
 *
 * NEVER edit files in generated/ — change the openapi.json specs (model) or
 * the files in manual/ (wiring) and re-run:  npm run schema:generate
 *
 * Mapping rules (documented in Docs/SCHEMA_GENERATION.md):
 *  - string -> String, integer -> Int, number -> Float, boolean -> Boolean
 *  - string format:date/date-time -> custom scalar Date
 *  - property named "id" or ending in "Id" ("Ids" for arrays) -> ID
 *  - enum -> GraphQL enum; name is PascalCase(prop), prefixed with the type
 *    name when two types share a prop name with different value sets
 *  - $ref -> referenced type name (must not be excluded)
 *  - required && !nullable -> non-null (!)
 *  - array -> [Inner!] (items assumed non-null), outer ! from required
 *  - config.directives injects Grafbase directives onto generated types/fields
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

// Load a Swagger/OpenAPI spec from YAML (source of truth) or JSON (still
// supported for back-compat) based on file extension.
function loadSpec(absPath) {
  const raw = readFileSync(absPath, "utf8");
  return extname(absPath).toLowerCase() === ".json" ? JSON.parse(raw) : YAML.parse(raw);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const GENERATED_DIR = join(HERE, "generated");
const MANUAL_DIR = join(HERE, "manual");

const config = JSON.parse(readFileSync(join(HERE, "config.json"), "utf8"));
const exclude = new Set(config.excludeSchemas ?? []);
const SCALAR_MAP = { string: "String", integer: "Int", boolean: "Boolean", number: "Float" };
const pascal = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const refName = ($ref) => $ref.split("/").pop();

// ---------------------------------------------------------------------------
// Load all specs up front.
// ---------------------------------------------------------------------------
const services = config.services.map((svc) => {
  const specPath = join(ROOT, svc.spec);
  const spec = loadSpec(specPath);
  if (!spec.components?.schemas) {
    throw new Error(`${svc.spec}: no components.schemas found — the Swagger spec must define its models.`);
  }
  return { ...svc, specPath: svc.spec, spec };
});

// ---------------------------------------------------------------------------
// Pass 1 — collect every enum so names can be resolved deterministically.
// Base name = PascalCase(prop). If two different value sets claim the same
// base name (e.g. Account.status vs Policy.status) EVERY claimant gets the
// TypeName prefix, keeping naming symmetric and order-independent.
// ---------------------------------------------------------------------------
const enumClaims = new Map(); // baseName -> [{ service, typeName, prop, values }]
for (const { name: service, spec } of services) {
  for (const [typeName, schema] of Object.entries(spec.components.schemas)) {
    if (exclude.has(typeName)) continue;
    for (const [prop, def] of Object.entries(schema.properties ?? {})) {
      const enumDef = def.enum ? def : def.items?.enum ? def.items : null;
      if (!enumDef) continue;
      const base = pascal(prop);
      if (!enumClaims.has(base)) enumClaims.set(base, []);
      enumClaims.get(base).push({ service, typeName, prop, values: enumDef.enum });
    }
  }
}

const enumNameByProp = new Map(); // "Type.prop" -> resolved enum name
const enumsByName = new Map(); // resolved name -> { values, service }
for (const [base, claims] of enumClaims) {
  const distinct = new Set(claims.map((c) => JSON.stringify(c.values)));
  for (const claim of claims) {
    const name = distinct.size === 1 ? base : `${claim.typeName}${base}`;
    const existing = enumsByName.get(name);
    if (existing && JSON.stringify(existing.values) !== JSON.stringify(claim.values)) {
      throw new Error(`Enum name collision for "${name}" with different values — rename the property or extend the naming rule.`);
    }
    if (!existing) enumsByName.set(name, { values: claim.values, service: claim.service });
    enumNameByProp.set(`${claim.typeName}.${claim.prop}`, name);
  }
}

// ---------------------------------------------------------------------------
// Pass 2 — emit SDL per service.
// ---------------------------------------------------------------------------
const usedScalars = new Set();

function gqlType(typeName, prop, def) {
  if (def.$ref) {
    const target = refName(def.$ref);
    if (exclude.has(target)) throw new Error(`${typeName}.${prop} references excluded schema "${target}".`);
    return target;
  }
  if (def.enum) {
    return config.enumsAsStrings ? "String" : enumNameByProp.get(`${typeName}.${prop}`);
  }
  if (def.type === "array") {
    // fooIds -> recurse as fooId so the ID heuristic applies to the items.
    const itemProp = /Ids$/.test(prop) ? prop.slice(0, -1) : prop;
    return `[${gqlType(typeName, itemProp, def.items ?? { type: "string" })}!]`;
  }
  if (def.type === "string") {
    if (def.format === "date" || def.format === "date-time") {
      usedScalars.add("Date");
      return "Date";
    }
    if (prop === "id" || /Id$/.test(prop)) return "ID";
    return "String";
  }
  return SCALAR_MAP[def.type] ?? "String";
}

function banner(lines) {
  const width = 77;
  return ["# " + "=".repeat(width), ...lines.map((l) => `# ${l}`), "# " + "=".repeat(width)].join("\n");
}

const generatedFiles = [];
mkdirSync(GENERATED_DIR, { recursive: true });

let totalTypes = 0;
for (const { name: service, specPath, spec, spec: { info } } of services) {
  const chunks = [
    banner([
      "GENERATED FILE — DO NOT EDIT",
      `Source : ${specPath} (${info.title} v${info.version})`,
      "Emitted: schema-gen/generate.mjs  —  regenerate with: npm run schema:generate",
    ]),
    "",
  ];

  for (const [typeName, schema] of Object.entries(spec.components.schemas)) {
    if (exclude.has(typeName)) continue;
    const required = new Set(schema.required ?? []);
    const typeDirectives = (config.directives?.[typeName] ?? []).join(" ");
    const fields = Object.entries(schema.properties ?? {}).map(([prop, def]) => {
      const bang = required.has(prop) && !def.nullable ? "!" : "";
      const fieldDirectives = (config.directives?.[`${typeName}.${prop}`] ?? []).map((d) => ` ${d}`).join("");
      const desc = def.description ? `  """${def.description}"""\n` : "";
      return `${desc}  ${prop}: ${gqlType(typeName, prop, def)}${bang}${fieldDirectives}`;
    });
    chunks.push(`type ${typeName}${typeDirectives ? ` ${typeDirectives}` : ""} {\n${fields.join("\n")}\n}`);
    chunks.push("");
    totalTypes += 1;
  }

  for (const [name, { values, service: owner }] of enumsByName) {
    if (owner !== service) continue;
    chunks.push(`enum ${name} {\n${values.map((v) => `  ${v}`).join("\n")}\n}`);
    chunks.push("");
  }

  const outPath = join(GENERATED_DIR, `${service}.types.graphql`);
  writeFileSync(outPath, chunks.join("\n").trimEnd() + "\n");
  generatedFiles.push(outPath);
  console.log(`generated/${service}.types.graphql`);
}

// Shared custom scalars (deduped across services).
const sharedPath = join(GENERATED_DIR, "_shared.graphql");
const sharedChunks = [
  banner([
    "GENERATED FILE — DO NOT EDIT",
    "Custom scalars shared by all generated service types.",
    "Emitted: schema-gen/generate.mjs  —  regenerate with: npm run schema:generate",
  ]),
  "",
  ...[...usedScalars].sort().map((s) => `"""ISO-8601 date string, e.g. \\"2016-04-18\\" (passed through from REST)."""\nscalar ${s}\n`),
];
writeFileSync(sharedPath, sharedChunks.join("\n").trimEnd() + "\n");
console.log("generated/_shared.graphql");

// ---------------------------------------------------------------------------
// Compose: header + generated + federation overlay -> schema.generated.graphql
// ---------------------------------------------------------------------------
const section = (title) => `\n${banner([title])}\n`;
const composed = [
  banner([
    "COMPOSED SCHEMA — schema-gen/schema.generated.graphql",
    "Built by schema-gen/generate.mjs from:",
    "  manual/header.graphql      (hand-written endpoints)",
    "  generated/*.graphql        (types generated from mock-rest-apis/*/openapi.yaml)",
    "  manual/federation.graphql  (hand-written @rest wiring + cross-service joins)",
    "Do not edit this file directly — edit the specs or the manual/ files,",
    "then run: npm run schema:generate",
  ]),
  "",
  readFileSync(join(MANUAL_DIR, "header.graphql"), "utf8").trimEnd(),
  section("GENERATED TYPES (from Swagger components.schemas) — DO NOT EDIT"),
  readFileSync(sharedPath, "utf8").trimEnd(),
  "",
  ...generatedFiles.map((f) => readFileSync(f, "utf8").trimEnd() + "\n"),
  section("MANUAL FEDERATION OVERLAY (hand-written — safe to edit in manual/)"),
  readFileSync(join(MANUAL_DIR, "federation.graphql"), "utf8").trimEnd(),
  "",
].join("\n");

const composedPath = join(HERE, "schema.generated.graphql");
writeFileSync(composedPath, composed);
console.log(`\ncomposed  schema-gen/schema.generated.graphql (${totalTypes} types, ${enumsByName.size} enums, ${usedScalars.size} scalar${usedScalars.size === 1 ? "" : "s"})`);
