# Tier 3 — Premium: cross-dataset SQL with R2 SQL (incl. DLP × HTTP)

Tier 1/2 give you a per-user report on the free data path. **Tier 3** is for customers
who already own **Cloudflare One + WAF**, generate **DLP** events, and are willing to buy
some **R2** — the scenario where you want *true* SQL joins across raw datasets, including
the **DLP × HTTP** correlation Log Explorer can't do today.

> This tier requires **Logpush** (Enterprise) and is **not** part of the free demo. It's
> documented here as the natural upgrade path.

## What lights up in this tier
These facets are **not** available on the free GraphQL Analytics path (verified
empirically) and require Logpush datasets:

- **File hash** — `BlockedFileHash` (and file name/size/type) from the `gateway_http`
  Logpush dataset. Powers the file-hash search and the lateral-spread pivot on real data.
- **Bytes transferred (upload/download)** — `bytessent` / `bytesreceived` from the
  **Zero Trust Network Session** Logpush dataset (rich session telemetry: source/egress IP,
  session start/end, resolved FQDN, etc.). The free GraphQL API exposes no byte aggregation
  and no network-session dataset.
- **DLP events** — the paid Cloudflare One feature; correlate DLP hits with HTTP/Gateway
  activity per user.

Categories, per-user identity, Access logins, and zone WAF are already available on the
**free** tier — see the main README.

## Pipeline

```
 Logpush jobs ─┬─ HTTP requests ─┐
               ├─ Gateway HTTP   ├─▶  R2 bucket  ─▶  R2 Data Catalog (Iceberg)  ─▶  R2 SQL
               ├─ Access         │                                                    │
               └─ DLP forensic   ┘                                                    ▼
                                                                        cross-dataset SQL JOINs
                                                                        (DLP × HTTP × Access)
```

1. **Logpush → R2.** Create Logpush jobs for the datasets you need (HTTP, Gateway HTTP,
   Access, DLP) with an R2 destination.
2. **R2 Data Catalog.** Land the data as Apache **Iceberg** tables (managed catalog on
   top of R2).
3. **R2 SQL.** Query across tables with standard SQL — the join that Log Explorer won't
   do natively.

## Example: DLP hits correlated with the user's web activity
```sql
-- Pseudocode — align to your Logpush schemas / table names.
SELECT
  dlp.user_email,
  dlp.dataset_name           AS dlp_profile,
  COUNT(*)                   AS dlp_hits,
  http.top_host,
  http.requests
FROM dlp_events AS dlp
LEFT JOIN (
  SELECT user_email,
         ANY_VALUE(http_host) AS top_host,
         COUNT(*)             AS requests
  FROM gateway_http
  WHERE datetime >= NOW() - INTERVAL '7' DAY
  GROUP BY user_email
) AS http
  ON http.user_email = dlp.user_email
WHERE dlp.datetime >= NOW() - INTERVAL '7' DAY
GROUP BY dlp.user_email, dlp.dataset_name, http.top_host, http.requests
ORDER BY dlp_hits DESC;
```

## Why this is the premium story
- **DLP** is a paid Cloudflare One feature and its events aren't on the free GraphQL
  path — so the DLP correlation belongs here.
- **Logpush** (Enterprise) gives raw per-event rows with full fidelity and your own
  retention in R2.
- **R2 SQL** provides the cross-dataset JOIN engine, self-hosted and pay-as-you-go.

## Cost sketch
Logpush (incl. with Enterprise) + R2 storage (per-GB, first 10 GB free) + R2 SQL
(data scanned). Far cheaper than most SIEM ingestion for the same questions, and the
data stays in your account.

*Verify current product availability, dataset schemas, and pricing in Cloudflare's docs
before quoting to a customer.*
