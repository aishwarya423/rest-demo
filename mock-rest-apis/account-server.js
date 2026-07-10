const http = require("http");

//To run locally on 3 diffrent ports at a time : comment below 2 lines, serviceName and port
// const PORTS = {
//   accounts: Number(process.env.ACCOUNTS_PORT || 3001),
//   policies: Number(process.env.POLICIES_PORT || 3002),
//   funds:    Number(process.env.FUNDS_PORT    || 3003),
// };


// In Docker each container runs one service, selected by SERVICE_NAME + PORT.
// Locally (outside Docker) you can still run all three by setting those vars
// or just letting them default to their respective ports.
const serviceName = process.env.SERVICE_NAME || "accounts";
const port = Number(process.env.PORT || 3001);
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

const openApiByService = {
  accounts: {
    openapi: "3.0.3",
    info: { title: "Accounts REST API", version: "1.0.0" },
    paths: {
      "/accounts": { get: { summary: "List accounts" } },
      "/accounts/{id}": { get: { summary: "Get account by id" } },
      "/customers/{customerId}/accounts": { get: { summary: "List accounts for a customer" } }
    }
  },
  policies: {
    openapi: "3.0.3",
    info: { title: "Policies REST API", version: "1.0.0" },
    paths: {
      "/policies": { get: { summary: "List policies" } },
      "/policies/{id}": { get: { summary: "Get policy by id" } },
      "/accounts/{accountId}/policies": { get: { summary: "List policies for an account" } },
      "/funds/{fundId}/policies": { get: { summary: "List policies linked to a fund" } }
    }
  },
  funds: {
    openapi: "3.0.3",
    info: { title: "Funds REST API", version: "1.0.0" },
    paths: {
      "/funds": { get: { summary: "List funds" } },
      "/funds/{id}": { get: { summary: "Get fund by id" } },
      "/accounts/{accountId}/funds": { get: { summary: "List funds held by an account" } }
    }
  }
};

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
      sendJson(res, 200, openApiByService[serviceName]);
      return;
    }

    if (!authorize(req, res)) return;

    if (serviceName === "accounts") return accountsRouter(url, res);
    if (serviceName === "policies") return policiesRouter(url, res);
    if (serviceName === "funds") return fundsRouter(url, res);
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