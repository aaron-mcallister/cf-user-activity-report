# Deploying

Two very different deployments — don't mix them up:

## A. Public demo (recommended for sharing)
Synthetic data only. Safe to expose, no PII, no auth needed. This is what a public URL
like `activity.example.com` should run.

```bash
# in wrangler.jsonc: set DEMO_MODE = "on"
# add the custom domain route (zone must be on the deploying account):
#   "routes": [ { "pattern": "activity.example.com", "custom_domain": true } ]
npm install
npm run deploy
```

That's it — the deployed Worker serves the full demo (dashboard, search, malware /
Newly Seen Domains / file-hash pivot) with fabricated data.

## B. Live instance (real account data — treat as sensitive)
Serves real user activity (PII). **Must be protected** and should never be a public URL.

```bash
wrangler secret put CF_API_TOKEN        # scoped, read-only (see token-scopes.md)
# in wrangler.jsonc [vars]: DEMO_MODE = "off", set CF_ACCOUNT_ID (+ optional CF_ZONE_ID)
npm run deploy
```

Then protect it (pick one):
- **Cloudflare Access** in front of the Worker route (Zero Trust → Access → Applications) — recommended.
- Built-in Basic Auth: `wrangler secret put BASIC_AUTH_USER` + `BASIC_AUTH_PASS`.

The Worker refuses to serve live data unless one of these is configured (or you set
`ALLOW_UNAUTHENTICATED=true`, which you shouldn't for real data).

> Tip: keep any public URL on demo data; run an Access-protected instance for real data.

## Custom domain
Either add the `routes` block above (zone must be on the deploying account), or run
`npm run deploy` and attach a custom domain in the dashboard
(Workers & Pages → your Worker → Settings → Domains & Routes → Add → Custom Domain).

## Tier 2 — retention (optional, free up to 10 GB)
Uncomment the `r2_buckets` + `triggers.crons` block in `wrangler.jsonc`, create the bucket
(`wrangler r2 bucket create user-activity-history`), and redeploy. The scheduled handler
appends per-user NDJSON snapshots so you keep history beyond the platform's short window.
