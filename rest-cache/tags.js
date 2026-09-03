// =============================================================================
// Tag extraction — the ONLY file in rest-cache/ with domain knowledge.
//
// Answers one question per cached response: which logical entities does this
// response depend on? Those become Redis SET members, and invalidating a tag
// deletes every response that listed it.
//
// The important property: tags are derived from the RESPONSE BODY, not just the
// URL. `GET /accounts` is tagged with EVERY account it contains, so invalidating
// one account correctly drops the list too. A URL-only scheme would leave that
// list stale — which is the whole failure this layer exists to prevent.
//
// Adding a new REST route = adding one branch below.
// =============================================================================

const uniq = (xs) => [...new Set(xs.filter(Boolean))];

const accountTags = (a) => [
  `account:${a.id}`,
  a.customerId && `customer:${a.customerId}`,
  // DELIBERATE OVER-INVALIDATION (see rest-cache/README.md):
  // a fund change drops every account holding it. Safe, but wasteful if fund
  // content (name/currency) changes without affecting the account payload.
  // Delete this line to tighten the blast radius.
  ...(a.fundHoldings || []).map((h) => `fund:${h.fundId}`),
];

const policyTags = (p) => [
  `policy:${p.id}`,
  `account:${p.accountId}`,
  p.customerId && `customer:${p.customerId}`,
  ...(p.fundIds || []).map((id) => `fund:${id}`),
];

function tagsFor(service, pathname, body) {
  if (!body) return [];
  const parts = pathname.split("/").filter(Boolean);

  if (service === "accounts") {
    // GET /accounts
    if (pathname === "/accounts" && Array.isArray(body)) {
      return uniq(["collection:accounts", ...body.flatMap(accountTags)]);
    }
    // GET /customers/{id}/accounts
    if (parts[0] === "customers" && parts[2] === "accounts" && Array.isArray(body)) {
      return uniq([`customer:${parts[1]}`, ...body.flatMap(accountTags)]);
    }
    // GET /accounts/{id}
    if (parts[0] === "accounts" && parts[1] && body.id) {
      return uniq(accountTags(body));
    }
  }

  if (service === "policies") {
    // GET /accounts/{id}/policies  <- the route the REST extension actually calls
    if (parts[0] === "accounts" && parts[2] === "policies" && Array.isArray(body)) {
      return uniq([`account:${parts[1]}`, ...body.flatMap(policyTags)]);
    }
    // GET /funds/{id}/policies
    if (parts[0] === "funds" && parts[2] === "policies" && Array.isArray(body)) {
      return uniq([`fund:${parts[1]}`, ...body.flatMap(policyTags)]);
    }
    // GET /policies
    if (pathname === "/policies" && Array.isArray(body)) {
      return uniq(["collection:policies", ...body.flatMap(policyTags)]);
    }
    // GET /policies/{id}
    if (parts[0] === "policies" && parts[1] && body.id) {
      return uniq(policyTags(body));
    }
  }

  if (service === "funds") {
    // GET /funds
    if (pathname === "/funds" && Array.isArray(body)) {
      return uniq(["collection:funds", ...body.map((f) => `fund:${f.id}`)]);
    }
    // GET /funds/{id}
    if (parts[0] === "funds" && parts[1] && body.id) {
      return uniq([`fund:${body.id}`]);
    }
  }

  // Unknown route: still proxied, but never cached — see server.js (BYPASS).
  return [];
}

module.exports = { tagsFor };
