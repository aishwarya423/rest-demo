const http = require("http");

//To run locally on 3 diffrent ports at a time : comment below 2 lines, serviceName and port
// const PORTS = {
//   accounts: Number(process.env.ACCOUNTS_PORT || 3001),
// };

// In Docker each container runs one service, selected by SERVICE_NAME + PORT.
// Locally (outside Docker) you can still run all three by setting those vars
// or just letting them default to their respective ports.
const serviceName = process.env.SERVICE_NAME || "countries";
const port = 3004;
// const port = Number(process.env.PORT || 3001);
const expectedApiKey = process.env.EXPECTED_API_KEY || "";

const countries = [
  { name: { official: "Afghanistan" } },
  { name: { official: "Albania" } },
  { name: { official: "Algeria" } },
  { name: { official: "Andorra" } },
  { name: { official: "Angola" } },
  { name: { official: "Argentina" } },
  { name: { official: "Armenia" } },
  { name: { official: "Australia" } },
  { name: { official: "Austria" } },
  { name: { official: "Azerbaijan" } },
  { name: { official: "Bahamas" } },
  { name: { official: "Bahrain" } },
  { name: { official: "Bangladesh" } },
  { name: { official: "Barbados" } },
  { name: { official: "Belarus" } },
  { name: { official: "Belgium" } },
  { name: { official: "Belize" } },
  { name: { official: "Benin" } },
  { name: { official: "Bhutan" } },
  { name: { official: "Bolivia" } }
];

const openApiByService = {
  countries: {
    openapi: "3.0.3",
    info: { title: "Countries REST API", version: "1.0.0" },
    paths: {
      "/all": { get: { summary: "List all countries" } }
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

    if (serviceName === "countries") return countriesRouter(url, res);
  };
}

function countriesRouter(url, res) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.pathname === "/all" || url.pathname === "/all?fields=name") {
    return sendJson(res, 200, countries);
  }
  return notFound(res);
}

http.createServer(makeRouter(serviceName)).listen(port, () => {
  console.log(`${serviceName} REST API listening on port ${port}`);
});