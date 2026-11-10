# Security policy

This is a personal open-source project (not an official Cloudflare product). It can surface
real user activity (PII) when pointed at a live account, so security reports are welcome.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead:
**Security tab → "Report a vulnerability"** on this repository.

Include what you found, how to reproduce it, and the impact you expect. This is a
spare-time project, so responses are best-effort, but reports will be taken seriously and
credited if you'd like.

## Scope

In scope: authentication/authorization bypasses, injection (HTML, CSV, header), information
disclosure, and unsafe defaults in the Worker code and setup scripts.
Out of scope: issues in Cloudflare's own products or APIs (report those to Cloudflare), and
findings that require a deployment to ignore the documented guidance in `docs/deploy.md`.

## Safe-use basics

- Keep public URLs on demo data; run live data only behind Cloudflare Access **with** JWT
  verification (or Basic Auth).
- Use a scoped, read-only, expiring API token stored as a Wrangler secret — never in git.
- If a token is ever exposed, revoke and rotate it immediately.
