#!/usr/bin/env node
// Standalone preflight — verify your Cloudflare plan exposes the datasets this
// report needs, BEFORE deploying. Zero dependencies (Node 18+).
//
// Usage:
//   CF_API_TOKEN=xxx [CF_ACCOUNT_ID=xxx] node scripts/preflight.mjs
//
// Token scopes: Account Analytics:Read, Access: Audit Logs:Read (Zone Analytics:Read
// optional for WAF). See docs/token-scopes.md.

// Load .dev.vars (the file `npm run setup` writes) so this works right after setup,
// without needing the token exported in your shell. Env vars still take precedence.
import { existsSync, readFileSync } from "node:fs";
if (existsSync(".dev.vars")) {
  for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim().replace(/^["']|["']$/g, ""); // strip surrounding quotes
    if (val && process.env[key] === undefined) process.env[key] = val;
  }
}

const token = process.env.CF_API_TOKEN;
let account = process.env.CF_ACCOUNT_ID || null;
if (!token) {
  console.error("No API token found.");
  console.error("Run `npm run setup` and paste your token, then try again.");
  console.error("(Or set one for this command: CF_API_TOKEN=xxx npm run preflight)");
  process.exit(1);
}

const API = "https://api.cloudflare.com/client/v4";
const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const iso = (d) => d.toISOString();
const gql = (query) =>
  fetch(`${API}/graphql`, { method: "POST", headers: H, body: JSON.stringify({ query }) })
    .then((r) => r.json())
    .catch((e) => ({ errors: [{ message: String(e) }] }));

const ACCOUNT_DATASETS = [
  "gatewayL7RequestsAdaptiveGroups",
  "gatewayResolverQueriesAdaptiveGroups",
  "accessLoginRequestsAdaptiveGroups",
];

async function resolveAccount() {
  if (account) return account;
  const r = await fetch(`${API}/accounts?per_page=50`, { headers: H }).then((x) => x.json());
  const list = r?.result || [];
  if (list.length === 1) return list[0].id;
  if (list.length === 0) throw new Error("Token sees no accounts; set CF_ACCOUNT_ID.");
  console.error("Multiple accounts; set CF_ACCOUNT_ID to one of:");
  list.forEach((a) => console.error(`  ${a.id}  ${a.name}`));
  return list[0].id;
}

async function checkDataset(ds) {
  const s = new Date(Date.now() - 864e5), e = new Date();
  const q = `{ viewer { accounts(filter:{accountTag:"${account}"}) { ${ds}(limit:1, filter:{datetime_geq:"${iso(s)}", datetime_leq:"${iso(e)}"}) { count } } } }`;
  const r = await gql(q);
  if (r.errors) {
    const m = r.errors[0].message;
    if (/Cannot query field|Unknown field/i.test(m)) return { ds, status: "MISSING", note: m.slice(0, 80) };
    if (/not authorized|permission/i.test(m)) return { ds, status: "UNAUTHORIZED", note: m.slice(0, 80) };
    return { ds, status: "ERROR", note: m.slice(0, 80) };
  }
  const rows = r.data?.viewer?.accounts?.[0]?.[ds] || [];
  return { ds, status: rows.length ? "OK" : "EMPTY", note: rows.length ? `${rows[0].count} in 24h` : "no rows in 24h" };
}

async function checkIdentity() {
  const s = new Date(Date.now() - 864e5), e = new Date();
  const out = {};
  for (const f of ["email", "userId", "deviceId", "categoryNames"]) {
    const q = `{ viewer { accounts(filter:{accountTag:"${account}"}) { gatewayL7RequestsAdaptiveGroups(limit:1, filter:{datetime_geq:"${iso(s)}", datetime_leq:"${iso(e)}"}) { dimensions { ${f} } } } } }`;
    const r = await gql(q);
    out[f] = !r.errors;
  }
  return out;
}

async function probeRetention() {
  let maxOk = null;
  for (const d of [7, 14, 30, 45, 60, 90]) {
    const s = new Date(Date.now() - (d + 1) * 864e5); s.setUTCHours(0, 0, 0, 0);
    const e = new Date(s.getTime() + 864e5);
    const q = `{ viewer { accounts(filter:{accountTag:"${account}"}) { gatewayL7RequestsAdaptiveGroups(limit:1, filter:{datetime_geq:"${iso(s)}", datetime_leq:"${iso(e)}"}) { count } } } }`;
    const r = await gql(q);
    if (r.errors) { if (/older than|out of range|retention/i.test(r.errors[0].message)) break; }
    else maxOk = d;
  }
  return maxOk;
}

async function checkAccess() {
  const r = await fetch(`${API}/accounts/${account}/access/logs/access_requests?limit=1`, { headers: H });
  const j = await r.json().catch(() => null);
  return { status: r.status, ok: !!j?.success, note: j?.errors?.[0]?.message };
}

(async () => {
  account = await resolveAccount();
  console.log(`\nPreflight for account ${account}\n${"-".repeat(48)}`);

  const datasets = [];
  for (const ds of ACCOUNT_DATASETS) {
    const c = await checkDataset(ds);
    datasets.push(c);
    console.log(`  ${c.status.padEnd(12)} ${c.ds}  ${c.note ? "(" + c.note + ")" : ""}`);
  }

  const gw = datasets.find((d) => d.ds === "gatewayL7RequestsAdaptiveGroups");
  let identity, retention;
  if (gw && (gw.status === "OK" || gw.status === "EMPTY")) {
    identity = await checkIdentity();
    console.log(`\n  Identity dims on Gateway HTTP: ` +
      Object.entries(identity).map(([k, v]) => `${k}=${v ? "yes" : "no"}`).join("  "));
    retention = await probeRetention();
    console.log(`  Max retention window: ~${retention ?? "?"} days`);
  }
  const access = await checkAccess();
  console.log(`\n  Access logs REST: HTTP ${access.status} ${access.ok ? "OK" : "(" + (access.note || "unavailable") + ")"}`);

  const ready = gw && (gw.status === "OK" || gw.status === "EMPTY") && identity?.email;
  console.log(`\n${"-".repeat(48)}`);
  console.log(ready
    ? `✅ Ready. Per-user Gateway HTTP available${access.ok ? " + Access logins" : ""}. Deploy with: npm run deploy`
    : `⚠️  Not ready. Need Cloudflare One Gateway (HTTP filtering) + WARP so requests carry identity. See README.`);
  console.log("");
})().catch((e) => {
  console.error("\nCouldn't complete the preflight check.");
  console.error(`Reason: ${e?.message || e}`);
  console.error(
    "\nCommon fixes:\n" +
      "  • Double-check the token was copied in full (re-run `npm run setup`).\n" +
      "  • Make sure the token has: Account Analytics:Read + Access: Audit Logs:Read.\n" +
      "  • If your token can see more than one account, set CF_ACCOUNT_ID in .dev.vars.\n" +
      "  • See docs/token-scopes.md for the exact steps.",
  );
  process.exit(1);
});
