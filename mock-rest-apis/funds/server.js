const http = require("http");

//To run locally on 3 diffrent ports at a time : comment below 2 lines, serviceName and port
// const PORTS = {
//   funds:    Number(process.env.FUNDS_PORT    || 3003),
// };


// In Docker each container runs one service, selected by SERVICE_NAME + PORT.
// Locally (outside Docker) you can still run all three by setting those vars
// or just letting them default to their respective ports.
const serviceName = process.env.SERVICE_NAME || "funds";
const port = 3002;
// const port = Number(process.env.PORT || 3001);
const expectedApiKey = process.env.EXPECTED_API_KEY || "";

const funds = [
  {
    id: "fund-global-equity",
    isin: "GB00GLBEQ001",
    name: "Global Equity Index",
    assetClass: "EQUITY",
    currency: "GBP",
    riskRating: 5,
    ongoingChargePercent: 0.18,
    oneYearReturnPercent: 12.4,
    threeYearReturnPercent: 28.6,
    sustainabilityLabel: "STANDARD"
  },
  {
    id: "fund-green-bond",
    isin: "GB00GRNBD002",
    name: "Green Bond Income",
    assetClass: "FIXED_INCOME",
    currency: "GBP",
    riskRating: 3,
    ongoingChargePercent: 0.22,
    oneYearReturnPercent: 5.8,
    threeYearReturnPercent: 13.2,
    sustainabilityLabel: "SUSTAINABLE"
  },
  {
    id: "fund-cash-plus",
    isin: "GB00CASHP003",
    name: "Cash Plus Reserve",
    assetClass: "CASH",
    currency: "GBP",
    riskRating: 1,
    ongoingChargePercent: 0.08,
    oneYearReturnPercent: 4.1,
    threeYearReturnPercent: 8.4,
    sustainabilityLabel: "STANDARD"
  },
  {
    id: "fund-tech-growth",
    isin: "GB00TECHG004",
    name: "Technology Growth Opportunities",
    assetClass: "EQUITY",
    currency: "GBP",
    riskRating: 6,
    ongoingChargePercent: 0.35,
    oneYearReturnPercent: 18.9,
    threeYearReturnPercent: 41.7,
    sustainabilityLabel: "TRANSITION"
  }
];

// Swagger contract lives in the co-located openapi.yaml file — the single
// source of truth for this service's model (also consumed by the GraphQL
// schema generator in schema-gen/). Served verbatim at /openapi.yaml so the
// server needs no YAML parser.
const openApiYaml = require("fs").readFileSync(require("path").join(__dirname, "openapi.yaml"), "utf8");

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

    if (url.pathname === "/openapi.yaml") {
      res.writeHead(200, {
        "Content-Type": "application/yaml",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(openApiYaml);
      return;
    }

    if (!authorize(req, res)) return;

    if (serviceName === "funds") return fundsRouter(url, res);
  };
}

function fundsRouter(url, res) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.pathname === "/funds") return sendJson(res, 200, funds);
  if (parts[0] === "funds" && parts[1]) {
    const fund = funds.find((item) => item.id === parts[1]);
    return fund ? sendJson(res, 200, fund) : notFound(res);
  }
  if (parts[0] === "accounts" && parts[2] === "funds") {
    const account = accounts.find((item) => item.id === parts[1]);
    if (!account) return notFound(res);
    const accountFunds = account.fundHoldings
      .map((holding) => funds.find((fund) => fund.id === holding.fundId))
      .filter(Boolean);
    return sendJson(res, 200, accountFunds);
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