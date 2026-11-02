# Hive Console self-hosting — 5 minute brief

**Question:** Can we use Hive Console without sending our schemas and API data to Hive's cloud?
**Answer:** **Yes.** It is free, MIT licensed, and no data leaves our network.
**Catch:** There is no official Kubernetes setup. Production is a platform project.

Full detail: [CONFLUENCE-Hive-Console-Self-Hosting.md](./CONFLUENCE-Hive-Console-Self-Hosting.md)

---

## 1. What we asked vs what we found

| Question | Answer |
|---|---|
| Can we self-host the Console UI? | ✅ Yes, fully |
| Do schemas stay in our network? | ✅ Yes, all of them |
| Does usage analytics stay with us? | ✅ Yes |
| Are features locked behind payment? | ✅ No, none |
| Is it production-ready out of the box? | ❌ No, Docker Compose demo only |

---

## 2. What stays inside our network

| Our data | Stored in |
|---|---|
| Schemas, projects, schema checks | PostgreSQL |
| Usage analytics | ClickHouse |
| Schema artifacts, audit logs | Object storage (S3-style) |
| Login / users | Our instance |

**Nothing is sent to Hive's cloud.** Our router points at our own URL with one config line.

---

## 3. What we give up

Only two things are missing self-hosted:

| Missing | Does it matter to us? |
|---|---|
| Their global CDN | ❌ No — our instance serves the files itself |
| Billing integration | ❌ No — internal use, nothing to bill |
| Dedicated support + SLA | ⚠️ Yes — community support only unless we pay |

---

## 4. Cost

| | Hive Cloud | Self-hosted |
|---|---|---|
| Licence | Free tier, then $20/mo + usage | **Free** |
| Operations limit | 1M/month on free tier | **Unlimited** |
| Data retention | 7 days free, 90 days paid | **Our choice** |
| Real cost | subscription | **our servers + our time** |

---

## 5. What we would run

**14 containers.** 8 Hive services + 6 standard infrastructure pieces.

| Type | Components |
|---|---|
| Hive services | Console UI, API server, schema, policy, workflows, usage, usage-ingestor, migrations |
| Infrastructure | PostgreSQL, ClickHouse, Redis, Redpanda, object storage, proxy |

All standard, nothing exotic. We already run most of these elsewhere.

---

## 6. The one real problem

- Hive ships **Docker Compose only**, and their own docs call it a demo setup, **not production-ready**.
- **No official Kubernetes / Helm chart exists.** We checked the repo directly.
- Community Helm charts exist, but one says plainly "development and testing only".
- Good news: their own production setup (Pulumi + AWS + Kubernetes) is in the repo, MIT licensed. We would copy that, not build from scratch.

**Translation for planning:** evaluating is easy. Going live is a platform project, not a side task.

---

## 7. Recommendation

| Phase | What | Effort |
|---|---|---|
| **1. Evaluate** | Run the Docker Compose stack on an internal VM. Connect our POCs. Judge the UI, schema checks and analytics on real data. | **Days** |
| **2. Productionise** | Only if Phase 1 earns it. Port their Kubernetes setup, add backups, monitoring, SSO, HTTPS. | **Platform project** |

Do not mix the two. Phase 1 answers "is this good?". Phase 2 answers "can we run it?".

---

## 8. Three questions to ask The Guild

1. Is an official Helm / Kubernetes deployment planned?
2. Does SCIM user provisioning work self-hosted? (undocumented)
3. Can we buy Enterprise support for a self-hosted deployment?

All three change our effort estimate. All three are quick to ask.

---

## Bottom line

> Self-hosting gives us everything we wanted: Hive's Console UI and schema
> registry, with our schemas and business API data staying on our own
> infrastructure, at no licence cost.
>
> The work is not in licensing or features. It is in operating it properly.
> Recommend we start Phase 1 now and decide on Phase 2 with real evidence.
