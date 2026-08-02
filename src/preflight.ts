import type { ResolvedConfig } from "./config";
import { CloudflareApiError, gql, resolveAccountId } from "./cloudflare/graphql";

export interface DatasetCheck {
  dataset: string;
  status: "ok" | "empty" | "missing" | "unauthorized" | "error";
  note?: string;
}

export interface PreflightResult {
  demo: boolean;
  accountId?: string;
  datasets: DatasetCheck[];
  identityOnGatewayL7?: { field: string; ok: boolean }[];
  accessLogs?: { status: number; ok: boolean; note?: string };
  retentionDays?: number | null;
  recommendation: string;
}

const ACCOUNT_DATASETS = [
  "gatewayL7RequestsAdaptiveGroups",
  "gatewayResolverQueriesAdaptiveGroups",
  "accessLoginRequestsAdaptiveGroups",
];

function classify(message: string): DatasetCheck["status"] {
  if (/Cannot query field|Unknown field|doesn't exist/i.test(message)) return "missing";
  if (/not authorized|authz|permission|denied/i.test(message)) return "unauthorized";
  return "error";
}

const iso = (d: Date) => d.toISOString();

async function checkDataset(token: string, accountId: string, ds: string): Promise<DatasetCheck> {
  const start = new Date(Date.now() - 86_400_000);
  const end = new Date();
  const query = `{ viewer { accounts(filter:{accountTag:"${accountId}"}) {
    ${ds}(limit:1, filter:{datetime_geq:"${iso(start)}", datetime_leq:"${iso(end)}"}) { count } } } }`;
  try {
    const data = await gql(token, query);
    const rows = data?.viewer?.accounts?.[0]?.[ds] ?? [];
    return { dataset: ds, status: rows.length ? "ok" : "empty", note: rows.length ? `${rows[0].count} in 24h` : "no rows in 24h" };
  } catch (e) {
    const msg = e instanceof CloudflareApiError ? e.message : String(e);
    return { dataset: ds, status: classify(msg), note: msg.slice(0, 120) };
  }
}

async function checkIdentityDims(token: string, accountId: string): Promise<{ field: string; ok: boolean }[]> {
  const fields = ["email", "userId", "deviceId", "categoryNames"];
  const start = new Date(Date.now() - 86_400_000);
  const end = new Date();
  const out: { field: string; ok: boolean }[] = [];
  for (const f of fields) {
    const query = `{ viewer { accounts(filter:{accountTag:"${accountId}"}) {
      gatewayL7RequestsAdaptiveGroups(limit:1, filter:{datetime_geq:"${iso(start)}", datetime_leq:"${iso(end)}"}) { dimensions { ${f} } } } } }`;
    try {
      await gql(token, query);
      out.push({ field: f, ok: true });
    } catch {
      out.push({ field: f, ok: false });
    }
  }
  return out;
}

async function probeRetention(token: string, accountId: string): Promise<number | null> {
  const windows = [7, 14, 30, 45, 60, 90];
  let maxOk: number | null = null;
  for (const d of windows) {
    const s = new Date(Date.now() - (d + 1) * 86_400_000);
    s.setUTCHours(0, 0, 0, 0);
    const e = new Date(s.getTime() + 86_400_000);
    const query = `{ viewer { accounts(filter:{accountTag:"${accountId}"}) {
      gatewayL7RequestsAdaptiveGroups(limit:1, filter:{datetime_geq:"${iso(s)}", datetime_leq:"${iso(e)}"}) { count } } } }`;
    try {
      await gql(token, query);
      maxOk = d;
    } catch (e) {
      const msg = e instanceof CloudflareApiError ? e.message : String(e);
      if (/older than|out of range|retention|too far/i.test(msg)) break;
    }
  }
  return maxOk;
}

async function checkAccessLogs(token: string, accountId: string): Promise<PreflightResult["accessLogs"]> {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/access/logs/access_requests?limit=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const json = (await res.json().catch(() => null)) as any;
    return { status: res.status, ok: !!json?.success, note: json?.errors?.[0]?.message };
  } catch (e) {
    return { status: 0, ok: false, note: String(e) };
  }
}

export async function runPreflight(cfg: ResolvedConfig): Promise<PreflightResult> {
  if (cfg.demo) {
    return {
      demo: true,
      datasets: ACCOUNT_DATASETS.map((d) => ({ dataset: d, status: "ok", note: "demo mode" })),
      recommendation: "Demo mode active. Set CF_API_TOKEN and DEMO_MODE=off to preflight your real account.",
    };
  }
  if (!cfg.token) {
    return { demo: false, datasets: [], recommendation: "No CF_API_TOKEN set — cannot preflight." };
  }
  const accountId = await resolveAccountId(cfg.token, cfg.accountId);
  const datasets: DatasetCheck[] = [];
  for (const ds of ACCOUNT_DATASETS) datasets.push(await checkDataset(cfg.token, accountId, ds));

  const gwOk = datasets.find((d) => d.dataset === "gatewayL7RequestsAdaptiveGroups")?.status;
  const identityOnGatewayL7 =
    gwOk === "ok" || gwOk === "empty" ? await checkIdentityDims(cfg.token, accountId) : undefined;
  const retentionDays = gwOk === "ok" || gwOk === "empty" ? await probeRetention(cfg.token, accountId) : null;
  const accessLogs = await checkAccessLogs(cfg.token, accountId);

  const hasIdentity = identityOnGatewayL7?.some((f) => f.field === "email" && f.ok);
  const hasCategories = identityOnGatewayL7?.some((f) => f.field === "categoryNames" && f.ok);
  let recommendation: string;
  if (gwOk === "missing") {
    recommendation = "Gateway HTTP dataset not on this plan. Per-user web activity needs Cloudflare One Gateway with HTTP filtering + WARP.";
  } else if (!hasIdentity) {
    recommendation = "Gateway HTTP is present but identity dimensions are absent — deploy WARP so requests carry user identity.";
  } else {
    recommendation = `Ready. Per-user Gateway HTTP${hasCategories ? " + categories" : ""} + ${accessLogs?.ok ? "Access logins" : "(Access logs unavailable)"} available; ~${retentionDays ?? "?"}d retention. File hash + bytes need Logpush (Enterprise). Enable Tier 2 (R2) for longer history.`;
  }

  return { demo: false, accountId, datasets, identityOnGatewayL7, accessLogs, retentionDays, recommendation };
}
