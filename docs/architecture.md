# Architecture

## Data path (free tier, no Logpush)

```
                      ┌──────────────────────────────────────────────┐
 GraphQL Analytics ──▶│ fetchGatewayL7ByUserAction  (email/userId/... )│
 (account-scoped)     │ fetchGatewayL7HostsByUser   (email × host)     │
                      │ fetchZoneTopHosts / Firewall (optional zone)   │
 Access REST      ───▶│ fetchAccessLogs             (per-user logins)  │
                      └───────────────┬──────────────────────────────┘
                                      ▼
                         joinByIdentity()  ── key: normEmail(email)
                                      ▼
                         Report { meta, totals, users[], zone }
                                      ▼
                       renderDashboard() / renderUser() / CSV / JSON
```

## Why the join lives in the app
Log Explorer queries a single dataset at a time. A per-user activity report needs
Gateway HTTP **and** Access logins **and** (optionally) WAF events for the *same
person*. We fetch each dataset from its own API and correlate on identity in
`src/report/join.ts`. That in-app correlation is the whole point.

## Modules
- `src/cloudflare/graphql.ts` — GraphQL client + typed queries (Gateway L7, zone HTTP/WAF).
- `src/cloudflare/access.ts` — Access authentication logs REST client.
- `src/report/join.ts` — the identity join (email/userId/deviceId) → `UserActivity[]`.
- `src/report/aggregate.ts` — pure helpers (action classification, top-N, counters).
- `src/report/build.ts` — orchestrates fetch (or fixtures) → join → `Report`.
- `src/report/export.ts` — CSV serialization.
- `src/ui/*` — dependency-free, auto-escaping HTML rendering.
- `src/preflight.ts` — plan capability + retention probe.
- `src/retention/snapshot.ts` — Tier 2 R2 snapshot (scheduled).
- `src/fixtures.ts` — synthetic demo data, shaped like the real APIs.

## Demo mode
When there's no token (or `DEMO_MODE=on`), `build.ts` feeds synthetic fixtures through
the **same** join + render pipeline as live mode. So the demo exercises real code, and
newcomers see the tool work before wiring credentials.

## Key facts confirmed against a live account
- `gatewayL7RequestsAdaptiveGroups` exposes `email`, `userId`, `deviceId`, `action`,
  `httpHost`, `url` — real per-user web activity (requires WARP).
- `gatewayResolverQueriesAdaptiveGroups` (DNS) is **aggregate-only** — no identity dims.
- `/accounts/{id}/access/logs/access_requests` returns per-user login events
  (`user_email`, `app_name`, `allowed`, `country`, `created_at`, `ray_id`, …).
- GraphQL schema introspection is restricted; query known dataset names directly.
- Every GraphQL query must filter by `accountTag` / `zoneTag`.
