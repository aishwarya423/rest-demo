/**
 * Minimal REST client shared by the three subgraphs.
 *
 * Every GraphQL field in this POC bottoms out here. The REST services are never
 * modified; we only call the routes their openapi.yaml files already declare.
 */
export function createRestClient({ baseUrl, apiKey, label }) {
  let calls = 0;

  async function get(path) {
    calls += 1;
    const url = `${baseUrl}${path}`;
    const started = Date.now();

    const response = await fetch(url, {
      headers: apiKey
        ? { 'X-Api-Key': apiKey, accept: 'application/json' }
        : { accept: 'application/json' },
    });

    // Log every upstream call, so each federated query can be traced to the
    // REST requests it caused.
    console.log(
      `[${label}] REST GET ${path} -> ${response.status} (${Date.now() - started}ms, call #${calls})`,
    );

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`${label} REST ${path} failed: ${response.status} ${await response.text()}`);
    }
    return response.json();
  }

  return {
    get,
    callCount: () => calls,
  };
}
