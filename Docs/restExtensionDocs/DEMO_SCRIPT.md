# Demo Script — REST Extensions on the Grafbase Gateway

> **Target length:** 5–10 minutes
> **Audience:** developers + technical stakeholders
> **Story:** `<PROJECT-KEY>` — Implement REST Extensions on the Grafbase Gateway
>
> **How to use this:** The spoken lines are what you say out loud — keep them natural, don't read them word-for-word. `[Presenter note]` lines are *not* spoken; they tell you what to click or show. `▶ Switch to …` markers tell you when to change windows. Anticipated Q&A is at the end of each section.

---

## 0. Before you start (setup checklist — do this 10 min early)

`[Presenter note]` Get all of this running and arranged *before* anyone is watching:

- [ ] Start the mock REST services + gateway. Either:
  - `docker compose up --build -d` (then `docker compose ps` to confirm all up), **or**
  - `npm start` (runs mock APIs + gateway + GraphiQL together).
- [ ] Confirm the gateway is live at **http://localhost:5050/graphql** and the explorer at **http://localhost:5173**.
- [ ] Open windows in this order and leave them ready to Alt-Tab:
  1. **IDE** — with `schema.graphql`, `grafbase.toml`, and `docker-compose.yml` already open in tabs.
  2. **Terminal** — cleared, in the project root.
  3. **GraphiQL / explorer** in the browser, with the `InsurancePortfolio` query already pasted in but **not yet run**.
- [ ] Have a fallback screenshot of a successful response, in case the network hiccups live.

> Tip: run the query once privately before the demo so the response is warm and you know it works.

---

## 1. Introduction  *(~45 sec)*

> "Thanks everyone. So this story was about implementing **REST Extensions on the Grafbase Gateway**. The goal was pretty focused: take a set of existing REST services we already have and expose them through a **single GraphQL API** — but do it *declaratively*, without writing a bunch of custom resolver code.
>
> The reason this mattered is that we want teams to consume our backends through one clean, typed graph instead of calling a handful of REST endpoints and stitching the results together themselves. This story was really about proving out a reusable pattern for that."

`[Presenter note]` Stay on your face-cam / title slide here. No screen-sharing yet.

**Likely questions**
- *"Is this replacing our REST services?"* → "No — the REST services stay exactly as they are. The gateway sits in front of them and translates. We didn't change a single line of REST server code."
- *"Why GraphQL at all?"* → "One request instead of many, a typed schema clients can explore, and the client asks only for the fields it needs."

---

## 2. Problem Statement  *(~1 min)*

> "Let me set up the problem first. Today those capabilities live in **three separate REST services** — in the demo they're Accounts, Policies, and Funds. Each has its own base URL, its own auth, its own response shape.
>
> If a client wants a full picture — an account, its policies, and the funds behind them — it has to call all three services and join everything together itself. That's repetitive, and every consumer re-implements the same stitching.
>
> The traditional way to put GraphQL in front of that is to **hand-write resolvers** for every field — and that's code you have to build, test, and maintain forever.
>
> That's why we went with **Grafbase REST Extensions**. The gateway can already federate GraphQL sources; the REST extension lets it treat a REST API as a virtual subgraph and map endpoints to GraphQL fields **through schema directives instead of code**. So we get the unified graph without owning a pile of resolver code."

`[Presenter note]` Optional: show the simple architecture diagram from the Confluence page here.

**Likely questions**
- *"Why not just build a thin BFF / custom GraphQL server?"* → "We could, but that's exactly the boilerplate we're trying to avoid. The extension gives us the mapping declaratively and handles the fan-out for us."
- *"Does this add a lot of latency?"* → "There's one extra hop through the gateway, but it also lets us dedupe and later cache downstream calls, which usually nets out better than clients calling everything separately."

---

## 3. Solution Overview  *(~1.5 min)*

> "At a high level, here's what I built. There's one virtual subgraph that declares our three REST endpoints, and then the GraphQL schema wires individual fields to REST calls.
>
> Two directives do the heavy lifting. **`@restEndpoint`** declares a named endpoint — a base URL plus headers, like the API key. **`@rest`** goes on a GraphQL field and says: use *this* endpoint, *this* HTTP method and path, and here's how to reshape the JSON response — that reshaping is done with **jq** filters right in the schema.
>
> Now, one important detail: `@rest` on its own can only build a URL from the field's *own* arguments and static config. It can't see the *parent* object. So for the nested joins — an account's policies, the funds behind a policy — I used Grafbase's **Composite Schemas** directives: `@require` to pass a parent's `id` down into a child call, and `@derive` / `@lookup` to resolve entities by id and fan out lists. The nice part is I did **not** have to write a custom Rust extension — the shipped REST extension plus these standard directives cover the whole thing.
>
> So the flow is: client sends one GraphQL query → the gateway resolves each field by calling the right REST endpoint → it reshapes and joins the responses → and returns one result."

`[Presenter note]` Keep this verbal/diagram-level. You'll *show* the actual directives in the live walkthrough next — don't dive into code yet.

**Likely questions**
- *"What's the difference between the REST extension and the composite schema directives?"* → "The REST extension does REST-to-GraphQL for a single call. The composite schema directives handle relationships *between* calls — passing parent data down and joining. They work together."
- *"Is the extension something you wrote?"* → "No, it's Grafbase's official REST extension, shipped as a WebAssembly component. I configured and wired it — I'll show that in a second."

---

## 4. Live Demo Walkthrough  *(~3–4 min — the core)*

### 4a. Project structure

▶ **Switch to the IDE.**

> "Quick tour of the project. The whole solution really lives in three files. **`schema.graphql`** is the unified GraphQL schema plus the REST and join directives. **`grafbase.toml`** is the gateway config — where the extension and the API keys are wired. And **`docker-compose.yml`** spins up the three mock REST services, the gateway, and a GraphiQL explorer."

`[Presenter note]` Show the file tree briefly. Point at `schema.graphql`, `grafbase.toml`, `docker-compose.yml`, and the `grafbase_extensions/rest/0.5.2/` folder (the local extension build).

### 4b. Gateway configuration + REST extension setup

`[Presenter note]` Open **`grafbase.toml`**.

> "Here's the gateway config. This top block loads the REST extension — and notice it's pointing at a **local path**, `grafbase_extensions/rest/0.5.2`, not a remote version. I'll come back to *why* that's a local build in the challenges section.
>
> Below that, this is how secrets stay out of the repo: the extension config reads the per-service API keys **from environment variables**. So nothing sensitive is hard-coded — the schema just references `config.accountsApiKey` and so on."

`[Presenter note]` Highlight the `[extensions.rest]` path line and the `[extensions.rest.config.subgraphs.insurance]` keys pulling from `{{ env.* }}`.

### 4c. Schema — the important part

`[Presenter note]` Open **`schema.graphql`**. Scroll to the top `@link` + `@restEndpoint` block.

> "This is the heart of it. Up top, the two `@link`s import the REST directives and the composite-schema directives. Then I declare the three endpoints with `@restEndpoint` — each has a base URL and forwards an `X-Api-Key` header pulled from that config we just saw."

`[Presenter note]` Scroll to `type Query` → the `account` field.

> "Now a real field. `account(id:)` uses `@rest` — method GET, path `/accounts/{{ args.id }}`, and this `selection` block is the jq filter that reshapes the REST JSON into our `Account` type."

`[Presenter note]` Scroll to `Account.policies`.

> "Here's a join. `policies` is a nested field with **no arguments of its own**, so `@rest` alone couldn't reach the parent account's id. The `@require(field: \"id\")` injects the parent `account.id` as a hidden `accountId` argument, and *that* builds the path `/accounts/{accountId}/policies` on the Policies service."

`[Presenter note]` Scroll to `FundHolding.fund` and `Policy.linkedFunds`.

> "And these two show the fan-out. `@derive` plus `@is` take an id — or a *list* of ids — off the parent and resolve each one through the `Fund` `@lookup`, which is just `GET /funds/{id}`. The internal join fields like `fundId` are marked `@inaccessible`, so clients never see them — the public schema stays clean."

### 4d. Running the gateway

▶ **Switch to the terminal.**

`[Presenter note]` If already running from setup, just show status. Otherwise run it live.

> "The gateway and the mock services are running via docker compose — let me confirm."

`[Presenter note]` Run:
```bash
docker compose ps
```
> "All up — three REST services, the gateway on 5050, and the explorer on 5173."

### 4e. Sending a GraphQL query + showing multi-service responses

▶ **Switch to the browser / GraphiQL explorer.**

`[Presenter note]` The `InsurancePortfolio` query is already pasted in. Show it before running.

> "Here's a single query. I'm asking for an account, its policies, the funds linked to each policy, *and* the account's fund holdings — data that lives across all three REST services. Watch: one request."

`[Presenter note]` Click **Run**. Let the response render.

> "And there's the joined response. The account came from the **Accounts** service, the policies from the **Policies** service, and every fund — both under the policies and under the holdings — from the **Funds** service. The client sent *one* GraphQL query and never had to know there were three backends behind it."

`[Presenter note]` (Optional, powerful) Show the gateway logs so people see the actual REST fan-out:
```bash
docker compose logs -f grafbase
```
> "If I tail the gateway logs, you can see the individual REST calls it made and joined under the hood — the account fetch, the policies fetch, and one funds lookup per id."

**Likely questions**
- *"What's that `selection` syntax?"* → "Standard jq. It reshapes the REST JSON into the GraphQL field's shape, right there in the schema — no mapping code."
- *"What if a fund appears twice?"* → "The lookups are deduplicated where possible, so we don't refetch the same fund id."
- *"Can it do writes, not just reads?"* → "Yes — `@rest` supports POST/PUT/etc. with a request body; this demo focuses on reads."
- *"Is the API key visible to clients?"* → "No. It's injected server-side from env config into the outbound REST header; it never leaves the gateway."

---

## 5. Benefits  *(~45 sec)*

▶ **Switch back to slides or just speak to the audience.**

> "So why is this approach better? A few things.
>
> **Less boilerplate** — there are no hand-written resolvers; the mapping *is* the schema. **Maintainability** — adding or changing a field is a schema edit and a review, not new code to test and deploy. **Scalability** — onboarding another REST service is just another `@restEndpoint` plus some fields. **Easier integration** — one typed graph that clients can explore, instead of three REST contracts they have to learn and stitch. And it keeps a **clean public API** while secrets stay in config, not in the repo."

**Likely questions**
- *"How does a new developer learn the API?"* → "They open GraphiQL and introspect it — the schema is self-documenting."
- *"Does declarative mean less flexible?"* → "For the 90% case it's faster and safer. If something truly custom comes up, Grafbase still supports writing a full resolver extension — we just didn't need one here."

---

## 6. Challenges Faced  *(~45 sec — this is the authentic bit, lean into it)*

> "It wasn't totally frictionless. The main one: when I first ran the gateway, the REST extension **failed to download** — a 404 pulling `rest/0.5.0` from the registry. That version wasn't available remotely.
>
> Rather than get blocked, I **built the extension locally** from Grafbase's extensions repo with the CLI, dropped the compiled `.wasm` and manifest into the project, and pointed `grafbase.toml` at that local path — that's the `0.5.2` build you saw. More reliable, and it pins the version so the demo and CI don't depend on the registry being up.
>
> The other real learning was **schema mapping** — getting the jq `selection` filters to match each REST payload exactly. My approach there was to curl each endpoint, work out the jq filter in the terminal until the JSON matched the GraphQL type, and *then* paste it into the schema. And there's a config gotcha worth flagging: when the gateway runs inside docker it has to use the **service DNS names**, but running it on the host uses `localhost` ports — those base URLs are the thing that trips people up."

`[Presenter note]` If asked, you can open `Docs/HOW_TO_IMPLEMENT.md` — it documents the 404 → local-build fix step by step.

**Likely questions**
- *"Is pinning to a local build a long-term problem?"* → "It's fine for now and it's deterministic. Once the registry version we want is reliably published, switching back is a one-line change in `grafbase.toml`."
- *"How did you debug the mapping issues?"* → "curl + jq in the terminal first, then move the working filter into the schema. Fast feedback loop."

---

## 7. Future Enhancements  *(~30 sec)*

> "A few things I'd build on next: **auth propagation** so we can forward client identity to the REST services; **caching** with per-service TTLs to cut down the fan-out; **environment-based endpoint config** so base URLs come from config per environment instead of the schema; and better **observability** — tracing and metrics across the REST hops. Longer term: rate limiting to protect the downstream services, and a clean story for **extension versioning** and CI checks on schema composition."

**Likely questions**
- *"Which of those is most important first?"* → "Caching and auth propagation — they're what make this production-ready for real traffic."

---

## 8. Closing  *(~20 sec)*

> "So to wrap up: this story delivered a **schema-driven** way to expose multiple REST services through a **single GraphQL API** on the Grafbase Gateway — with the joins handled by standard composite-schema directives and **zero custom resolver code**. It's a clean, reusable pattern we can point at the next set of REST backends whenever we're ready.
>
> **I'm happy to answer any questions.**"

`[Presenter note]` Leave the successful GraphiQL response on screen while you take questions — it's your best visual.

---

## Appendix A — The exact query to demo (`InsurancePortfolio`)

```graphql
query InsurancePortfolio {
  account(id: "acct-1001") {
    id
    holderName
    accountType
    totalValue
    policies {              # Policies service
      policyNumber
      productName
      status
      linkedFunds {         # Funds service (fan-out by id list)
        name
        assetClass
        oneYearReturnPercent
      }
    }
    fundHoldings {          # embedded in the Account
      allocationPercent
      currentValue
      fund {                # Funds service (single lookup)
        name
        riskRating
        sustainabilityLabel
      }
    }
  }
}
```

**Under the hood this triggers:**
```
1. GET /accounts/acct-1001                      (accounts service)
2. GET /accounts/acct-1001/policies             (policies service)
3. GET /funds/{id}  per policy fundId           (funds service)
4. GET /funds/{id}  per holding fundId           (funds service, deduped)
```

> A simpler warm-up query if you want to start small: `query { countries { name } }`.

## Appendix B — Handy commands during the demo

```bash
docker compose up --build -d      # start everything
docker compose ps                 # confirm all services are up
docker compose logs -f grafbase   # watch the gateway make REST calls
docker compose down               # tear down after
```

Gateway: **http://localhost:5050/graphql** · Explorer: **http://localhost:5173**

## Appendix C — Timing cheat sheet

| Section | Target |
|---------|--------|
| Intro | 0:45 |
| Problem | 1:00 |
| Solution overview | 1:30 |
| **Live demo** | 3:30 |
| Benefits | 0:45 |
| Challenges | 0:45 |
| Future | 0:30 |
| Closing | 0:20 |
| **Total** | **~9 min** (leaves buffer for questions) |

> If you're running long, the two safe things to trim are the log-tailing step (4e optional) and the Future Enhancements detail.

---

> **Placeholders:** fill in `<PROJECT-KEY>` and confirm your ports/URLs match your run mode (docker vs. `npm start` / `grafbase dev`). If you send me screenshots or the final Confluence page, I'll tailor the wording to exactly what's on your screen.
