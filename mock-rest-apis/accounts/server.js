const http = require("http");

//To run locally on 3 diffrent ports at a time : comment below 2 lines, serviceName and port
// const PORTS = {
//   accounts: Number(process.env.ACCOUNTS_PORT || 3001),
// };


// In Docker each container runs one service, selected by SERVICE_NAME + PORT.
// Locally (outside Docker) you can still run all three by setting those vars
// or just letting them default to their respective ports.
const serviceName = process.env.SERVICE_NAME || "accounts";
const port = 3001 ;
// const port = Number(process.env.PORT || 3001);
const expectedApiKey = process.env.EXPECTED_API_KEY || "";

const accounts = [
  {
    id: "acct-1001",
    customerId: "cust-501",
    holderName: "Anika Rao",
    accountType: "PENSION",
    status: "ACTIVE",
    openedDate: "2016-04-18",
    pensionProvider: "Northstar Retirement",
    riskProfile: "BALANCED",
    totalValue: 186420.75,
    contributionRate: 8.5,
    fundHoldings: [
      { fundId: "fund-global-equity", allocationPercent: 45, units: 1230.52, currentValue: 83900.12 },
      { fundId: "fund-green-bond", allocationPercent: 30, units: 812.08, currentValue: 55926.22 },
      { fundId: "fund-cash-plus", allocationPercent: 25, units: 512.2, currentValue: 46594.41 }
    ]
  },
  {
    id: "acct-1002",
    customerId: "cust-501",
    holderName: "Anika Rao",
    accountType: "INVESTMENT_ISA",
    status: "ACTIVE",
    openedDate: "2020-09-02",
    pensionProvider: null,
    riskProfile: "GROWTH",
    totalValue: 74280.1,
    contributionRate: 0,
    fundHoldings: [
      { fundId: "fund-tech-growth", allocationPercent: 60, units: 412.4, currentValue: 44568.06 },
      { fundId: "fund-global-equity", allocationPercent: 40, units: 435.11, currentValue: 29712.04 }
    ]
  },
  {
    id: "acct-2001",
    customerId: "cust-902",
    holderName: "Noah Bennett",
    accountType: "PENSION",
    status: "ACTIVE",
    openedDate: "2012-01-10",
    pensionProvider: "Cedar Pension Trust",
    riskProfile: "CAUTIOUS",
    totalValue: 254920.4,
    contributionRate: 6,
    fundHoldings: [
      { fundId: "fund-green-bond", allocationPercent: 50, units: 1820.33, currentValue: 127460.2 },
      { fundId: "fund-cash-plus", allocationPercent: 50, units: 1188.67, currentValue: 127460.2 }
    ]
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

    if (serviceName === "accounts") return accountsRouter(url, res);
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

http.createServer(makeRouter(serviceName)).listen(port, () => {
  console.log(`${serviceName} REST API listening on port ${port}`);
});

//To run locally on 3 diffrent ports at a time : comment above 3 lines
// for (const [service, port] of Object.entries(PORTS)) {
//   http.createServer(makeRouter(service)).listen(port, () => {
//     console.log(`${service} REST API listening on port ${port}`);
//   });
// }
