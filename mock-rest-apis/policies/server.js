const http = require("http");

//To run locally on 3 diffrent ports at a time : comment below 2 lines, serviceName and port
// const PORTS = {
//   policies: Number(process.env.POLICIES_PORT || 3002),
// };


// In Docker each container runs one service, selected by SERVICE_NAME + PORT.
// Locally (outside Docker) you can still run all three by setting those vars
// or just letting them default to their respective ports.
const serviceName = process.env.SERVICE_NAME || "policies";
const port = 3003;
// const port = Number(process.env.PORT || 3001);
const expectedApiKey = process.env.EXPECTED_API_KEY || "";

const policies = [
  {
    id: "pol-life-3001",
    policyNumber: "LIF-UK-3001",
    accountId: "acct-1001",
    customerId: "cust-501",
    policyType: "LIFE_INSURANCE",
    productName: "Family Life Protect",
    status: "IN_FORCE",
    startDate: "2018-06-01",
    premiumMonthly: 42.5,
    sumAssured: 450000,
    insuredPerson: "Anika Rao",
    fundIds: []
  },
  {
    id: "pol-annuity-3002",
    policyNumber: "ANN-RET-3002",
    accountId: "acct-1001",
    customerId: "cust-501",
    policyType: "PENSION_ANNUITY",
    productName: "Retirement Income Builder",
    status: "ACCUMULATING",
    startDate: "2019-03-15",
    premiumMonthly: 625,
    sumAssured: 0,
    insuredPerson: "Anika Rao",
    fundIds: ["fund-global-equity", "fund-green-bond"]
  },
  {
    id: "pol-invest-3003",
    policyNumber: "INV-BOND-3003",
    accountId: "acct-1002",
    customerId: "cust-501",
    policyType: "INVESTMENT_BOND",
    productName: "Flexible Investment Bond",
    status: "IN_FORCE",
    startDate: "2021-11-20",
    premiumMonthly: 350,
    sumAssured: 0,
    insuredPerson: "Anika Rao",
    fundIds: ["fund-tech-growth", "fund-global-equity"]
  },
  {
    id: "pol-life-9001",
    policyNumber: "LIF-UK-9001",
    accountId: "acct-2001",
    customerId: "cust-902",
    policyType: "LIFE_INSURANCE",
    productName: "Mortgage Life Cover",
    status: "IN_FORCE",
    startDate: "2014-02-01",
    premiumMonthly: 38.75,
    sumAssured: 320000,
    insuredPerson: "Noah Bennett",
    fundIds: []
  }
];

// Swagger/OpenAPI contract lives in the co-located openapi.json file — the
// single source of truth for this service's model (also consumed by the
// GraphQL schema generator in schema-gen/).
const openApiSpec = require("./openapi.json");

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Api-Key"
  });
  res.end(JSON.stringify(body, null, 2));
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

function authorize(req, res) {
  if (!expectedApiKey) return true;
  if (req.headers["x-api-key"] === expectedApiKey) return true;
  sendJson(res, 401, { error: "Missing or invalid X-Api-Key" });
  return false;
}

function makeRouter(serviceName) {
  return function router(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, X-Api-Key"
      });
      res.end();
      return;
    }

    if (url.pathname === "/health") {
      sendJson(res, 200, { service: serviceName, ok: true });
      return;
    }

    if (url.pathname === "/openapi.json") {
      sendJson(res, 200, openApiSpec);
      return;
    }

    if (!authorize(req, res)) return;

    if (serviceName === "policies") return policiesRouter(url, res);
  };
}

function accountsRouter(url, res) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.pathname === "/accounts") return sendJson(res, 200, accounts);
  if (parts[0] === "accounts" && parts[1]) {
    const account = accounts.find((item) => item.id === parts[1]);
    return account ? sendJson(res, 200, account) : notFound(res);
  }
  if (parts[0] === "customers" && parts[2] === "accounts") {
    return sendJson(res, 200, accounts.filter((item) => item.customerId === parts[1]));
  }
  return notFound(res);
}

function policiesRouter(url, res) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.pathname === "/policies") return sendJson(res, 200, policies);
  if (parts[0] === "policies" && parts[1]) {
    const policy = policies.find((item) => item.id === parts[1]);
    return policy ? sendJson(res, 200, policy) : notFound(res);
  }
  if (parts[0] === "accounts" && parts[2] === "policies") {
    return sendJson(res, 200, policies.filter((item) => item.accountId === parts[1]));
  }
  if (parts[0] === "funds" && parts[2] === "policies") {
    return sendJson(res, 200, policies.filter((item) => item.fundIds.includes(parts[1])));
  }
  return notFound(res);
}

http.createServer(makeRouter(serviceName)).listen(port, () => {
  console.log(`${serviceName} REST API listening on port ${port}`);
});

//To run locally on 3 diffrent ports at a time : comment above 3 lines
// for (const [service, port] of Object.entries(PORTS)) {
//   http.createServer(makeRouter(service)).listen(port, () => {
//     console.log(`${service} REST API listening on port ${port}`);
//   });
// }