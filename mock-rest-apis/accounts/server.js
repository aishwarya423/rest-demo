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

const openApiByService = {
  accounts: {
    openapi: "3.0.3",
    info: { title: "Accounts REST API", version: "1.0.0" },
    paths: {
      "/accounts": {
        get: {
          summary: "List accounts",
          responses: {
            "200": {
              description: "A list of accounts",
              content: {
                "application/json": {
                  schema: { type: "array", items: { $ref: "#/components/schemas/Account" } }
                }
              }
            }
          }
        }
      },
      "/accounts/{id}": {
        get: {
          summary: "Get account by id",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" }, example: "acct-1001" }
          ],
          responses: {
            "200": {
              description: "The requested account",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Account" }
                }
              }
            },
            "404": {
              description: "Account not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/customers/{customerId}/accounts": {
        get: {
          summary: "List accounts for a customer",
          parameters: [
            { name: "customerId", in: "path", required: true, schema: { type: "string" }, example: "cust-501" }
          ],
          responses: {
            "200": {
              description: "Accounts belonging to the customer",
              content: {
                "application/json": {
                  schema: { type: "array", items: { $ref: "#/components/schemas/Account" } }
                }
              }
            }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: "apiKey", in: "header", name: "X-Api-Key" }
      },
      schemas: {
        Account: {
          type: "object",
          required: [
            "id",
            "customerId",
            "holderName",
            "accountType",
            "status",
            "openedDate",
            "pensionProvider",
            "riskProfile",
            "totalValue",
            "contributionRate",
            "fundHoldings"
          ],
          properties: {
            id: { type: "string", example: "acct-1001" },
            customerId: { type: "string", example: "cust-501" },
            holderName: { type: "string", example: "Anika Rao" },
            accountType: { type: "string", enum: ["PENSION", "INVESTMENT_ISA"], example: "PENSION" },
            status: { type: "string", enum: ["ACTIVE"], example: "ACTIVE" },
            openedDate: { type: "string", format: "date", example: "2016-04-18" },
            pensionProvider: {
              type: "string",
              nullable: true,
              description: "null for non-pension accounts",
              example: "Northstar Retirement"
            },
            riskProfile: {
              type: "string",
              enum: ["CAUTIOUS", "BALANCED", "GROWTH"],
              example: "BALANCED"
            },
            totalValue: { type: "number", example: 186420.75 },
            contributionRate: { type: "number", description: "Percent; 0 when not contributing", example: 8.5 },
            fundHoldings: {
              type: "array",
              items: { $ref: "#/components/schemas/FundHolding" }
            }
          }
        },
        FundHolding: {
          type: "object",
          required: ["fundId", "allocationPercent", "units", "currentValue"],
          properties: {
            fundId: { type: "string", example: "fund-global-equity" },
            allocationPercent: { type: "number", example: 45 },
            units: { type: "number", example: 1230.52 },
            currentValue: { type: "number", example: 83900.12 }
          }
        },
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: { type: "string", example: "Not found" }
          }
        }
      }
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