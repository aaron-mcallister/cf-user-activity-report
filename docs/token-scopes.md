# Creating your API token

This project only ever **reads** analytics and audit data — it never changes anything in
your account. You'll create a **read-only** token, hand it to the app, and revoke it when
you're done. No coding required.

## Click-by-click

1. Go to **[dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)**
   (Dashboard → **My Profile** → **API Tokens**).
2. Click **Create Token**, then next to **Create Custom Token** click **Get started**.
3. Give it a **Token name** like `user-activity-report`.
4. Under **Permissions**, set up these rows (click **+ Add more** to get another row):

   | # | First dropdown | Second dropdown | Third dropdown |
   |---|---|---|---|
   | 1 | **Account** | **Account Analytics** | **Read** |
   | 2 | **Account** | **Access: Audit Logs** | **Read** |
   | 3 *(optional)* | **Zone** | **Analytics** | **Read** |

   Row 3 is only needed if you want the origin-traffic / WAF panel for one of your
   websites.
5. Under **Account Resources**, choose **Include** → your account.
   *(Only if you added row 3:)* under **Zone Resources**, choose **Include** → the specific
   website (zone) you want.
6. *(Recommended)* Under **TTL**, set a short expiry (e.g. a week) so the token cleans
   itself up.
7. Click **Continue to summary** → **Create Token**.
8. **Copy the token now** — Cloudflare shows it only once. It's a long string of letters,
   numbers, and underscores.

## Use the token
Back in the project, run:
```bash
npm run setup
```
Paste the token when prompted — that's it. (See the main README, step 3, for the by-hand
alternative.)

To confirm your plan exposes the data:
```bash
npm run preflight
```
It prints which datasets are available, whether per-user identity is present, the Access
logs status, and the approximate retention window.

## Keep it safe
- The token is **read-only**, but still treat it like a password.
- `npm run setup` stores it in a local file called `.dev.vars` that never leaves your
  machine and is never committed to git.
- When deploying, add it with `wrangler secret put CF_API_TOKEN` (it stays a secret on
  Cloudflare's side). Never paste it into `wrangler.jsonc` or any file you commit.
- Revoke it anytime from the same API Tokens page when you're done testing.

## Notes / gotchas (for the technically curious)
- The `/user/tokens/verify` endpoint can return `401` for account-scoped tokens even when
  they're valid — don't use it as a health check. Hit a real dataset instead (the
  preflight does this).
- GraphQL requires an account/zone **filter** on every query; unfiltered queries return
  an authorization error by design.
