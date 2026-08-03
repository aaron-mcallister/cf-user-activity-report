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
npx wrangler secret put CF_API_TOKEN    # scoped, read-only (see token-scopes.md)
# in wrangler.jsonc [vars]: DEMO_MODE = "off", set CF_ACCOUNT_ID (+ optional CF_ZONE_ID)
npm run deploy
```

Then protect it (pick one):
- **Cloudflare Access** in front of the Worker (Zero Trust → Access → Applications) — recommended.
- Built-in Basic Auth: `npx wrangler secret put BASIC_AUTH_USER` + `BASIC_AUTH_PASS`.

The Worker refuses to serve live data unless one of these is present (or you set
`ALLOW_UNAUTHENTICATED=true`, which you shouldn't for real data).

### Protecting with Cloudflare Access (recommended)
The app **auto-detects** Cloudflare Access — once Access is in front, authenticated users
are let straight through, no app config needed.

1. **Zero Trust → Access → Applications → Add an application → Self-hosted.**
2. Set the application domain to your app's hostname.
3. Add a policy (e.g. Allow → *Emails ending in* `@yourcompany.com`), and enable a login
   method (One-time PIN works with no IdP setup).
4. Save. Visit the app — you'll get the Access login, then the report.

> ⚠️ **Mind the `*.workers.dev` bypass.** If you protect a **custom domain** with Access
> but leave the `workers.dev` URL enabled, that URL is an **unprotected way in**. Do one of:
> - protect the `workers.dev` route with Access too (one-click in the Access app), **or**
> - disable it by adding `"workers_dev": false` to `wrangler.jsonc` and redeploying, **or**
> - turn on **JWT verification** below (safe even if a route is exposed).

### Optional: verify the Access JWT (defense-in-depth)
For the strongest posture, have the app cryptographically verify the Access token (so a
forged request can't get in even on an exposed route):

1. In your Access application, copy the **Application Audience (AUD) Tag**
   (Access → Applications → your app → Overview).
2. Find your **team domain** (Zero Trust → Settings → Custom Pages, or the
   `https://<team>.cloudflareaccess.com` you log in through).
3. Set both in `wrangler.jsonc` `vars` and redeploy:
   ```jsonc
   "CF_ACCESS_TEAM_DOMAIN": "https://<your-team>.cloudflareaccess.com",
   "CF_ACCESS_AUD": "<your-application-aud-tag>"
   ```
When these are set, the app validates every request's Access JWT (signature + audience +
expiry) and rejects anything that doesn't check out.

> Tip: keep any public URL on demo data; run an Access-protected instance for real data.

## Custom domain
Either add the `routes` block above (zone must be on the deploying account), or run
`npm run deploy` and attach a custom domain in the dashboard
(Workers & Pages → your Worker → Settings → Domains & Routes → Add → Custom Domain).

<a id="retention"></a>
## Retention (optional, free up to 10 GB)
By default the Worker is **stateless** — it queries live and stores nothing, so the
zero-config deploy always just works. Retention is a one-time opt-in:

1. Enable R2 on your account once (Dashboard → **R2** → *Get started* / add a payment
   method — the first 10 GB-month is free).
2. Create the bucket: `npx wrangler r2 bucket create user-activity-history`
3. Uncomment the `r2_buckets` + `triggers.crons` block in `wrangler.jsonc`.
4. Redeploy: `npm run deploy`.

The scheduled handler then appends per-user NDJSON snapshots so you keep history beyond
the platform's short analytics window. Snapshots are aggregate per-user rollups (small) —
10 GB goes a long way. Leave the block commented to stay fully stateless.

## Troubleshooting

**`command not found: wrangler`** — Wrangler is a project dependency, not a global program.
Prefix commands with `npx`, e.g. `npx wrangler secret put CF_API_TOKEN`. (After
`npm install`, `npx` finds the local copy automatically.)

**Error 1104 "Script not found" on your `*.workers.dev` URL right after the first deploy** —
this is normal. The very first time an account uses a `workers.dev` subdomain it takes a
minute or two to propagate. Wait ~2 minutes and hard-refresh. If it persists past ~5
minutes, open **Workers & Pages → your Worker → Settings → Domains & Routes** and confirm
the `workers.dev` route is enabled (or just add a custom domain). The deploy itself
succeeded — this is only about the preview URL resolving.
