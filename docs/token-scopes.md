# API token scopes

This project only ever **reads** analytics and audit data. Create a **scoped, read-only,
short-expiry** custom token and treat it as sensitive.

## Create the token
Dash → **My Profile → API Tokens → Create Token → Create Custom Token**
(https://dash.cloudflare.com/profile/api-tokens)

| Permission | Level | Access | Why |
|---|---|---|---|
| **Account Analytics** | Account | Read | Gateway HTTP (L7) + other Zero Trust GraphQL datasets |
| **Access: Audit Logs** | Account | Read | Access authentication logs (`/access/logs/access_requests`) |
| **Analytics** | Zone | Read | *(optional)* origin HTTP + WAF/firewall events for a zone |

**Account Resources:** include the single account you're reporting on.
**Zone Resources:** include the specific zone only if you enabled the optional zone panel.

Set a short **TTL** and rotate/revoke when you're done testing.

## Store it safely
- **Local dev:** put it in `.dev.vars` (gitignored) as `CF_API_TOKEN="..."`.
- **Deployed:** `wrangler secret put CF_API_TOKEN`. Never commit it; never put it in
  `wrangler.jsonc`.

## Verify
```bash
CF_API_TOKEN=xxx npm run preflight
```
The preflight prints which datasets your plan exposes, whether per-user identity
dimensions are present, the Access logs status, and the approximate retention window.

## Notes / gotchas
- The `/user/tokens/verify` endpoint can return `401` for account-scoped tokens even
  when they're valid — don't use it as a health check. Hit a real dataset instead
  (the preflight does this).
- GraphQL requires an account/zone **filter** on every query; unfiltered queries return
  an authorization error by design.
