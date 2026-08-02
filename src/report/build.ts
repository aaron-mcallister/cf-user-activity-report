import type { Report, ReportMeta, ZoneRollup } from "../cloudflare/types";
import type { ResolvedConfig } from "../config";
import {
  fetchGatewayL7ByUserAction,
  fetchGatewayL7CategoriesByUser,
  fetchGatewayL7HostsByUser,
  fetchZoneFirewall,
  fetchZoneTopHosts,
  resolveAccountId,
} from "../cloudflare/graphql";
import { fetchAccessLogs } from "../cloudflare/access";
import { joinByIdentity, type JoinInput } from "./join";
import { getDemoData } from "../fixtures";

export interface Window {
  start: Date;
  end: Date;
  days: number;
}

const errMsg = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);

/** Build the full report, from either live Cloudflare APIs or demo fixtures. */
export async function buildReport(cfg: ResolvedConfig, win: Window): Promise<Report> {
  const notes: string[] = [];
  const sources = {
    gatewayL7: false,
    accessLogs: false,
    zone: false,
    categories: false,
    files: false,
    sessions: false,
  };
  let accountId = cfg.accountId || "demo-account";
  let zoneId = cfg.zoneId;
  let joinInput: JoinInput;
  let zone: ZoneRollup | undefined;

  if (cfg.demo) {
    const d = getDemoData(win);
    joinInput = {
      l7ByUserAction: d.l7ByUserAction,
      l7HostsByUser: d.l7HostsByUser,
      accessLogs: d.accessLogs,
      categoryRows: d.categoryRows,
      fileRows: d.fileRows,
      sessionRows: d.sessionRows,
    };
    zone = { topHosts: d.zoneTopHosts, firewall: d.zoneFirewall };
    sources.gatewayL7 = sources.accessLogs = sources.zone = true;
    sources.categories = sources.files = sources.sessions = true;
    accountId = "demo-account";
    zoneId = "demo-zone";
    notes.push("Demo mode — synthetic data. Set CF_API_TOKEN (and DEMO_MODE=off) for live data.");
  } else {
    if (!cfg.token) throw new Error("Live mode requires CF_API_TOKEN to be set.");
    accountId = await resolveAccountId(cfg.token, cfg.accountId);

    const [l7Action, l7Hosts, l7Cats, access] = await Promise.allSettled([
      fetchGatewayL7ByUserAction(cfg.token, accountId, win.start, win.end),
      fetchGatewayL7HostsByUser(cfg.token, accountId, win.start, win.end),
      fetchGatewayL7CategoriesByUser(cfg.token, accountId, win.start, win.end),
      fetchAccessLogs(cfg.token, accountId, win.start, win.end),
    ]);

    joinInput = {
      l7ByUserAction: l7Action.status === "fulfilled" ? l7Action.value : [],
      l7HostsByUser: l7Hosts.status === "fulfilled" ? l7Hosts.value : [],
      accessLogs: access.status === "fulfilled" ? access.value : [],
      // Categories are available on the free GraphQL path (categoryNames on
      // gatewayL7RequestsAdaptiveGroups) and are wired live here. File hash and
      // bytes-transferred are NOT on the free path (they come from Logpush datasets in the
      // Enterprise tier), so they stay demo-only. Demo mode shows the full experience.
      categoryRows: l7Cats.status === "fulfilled" ? l7Cats.value : [],
      fileRows: [],
      sessionRows: [],
    };
    sources.gatewayL7 = l7Action.status === "fulfilled";
    sources.accessLogs = access.status === "fulfilled";
    sources.categories = l7Cats.status === "fulfilled";
    if (l7Action.status === "rejected") notes.push(`Gateway L7 unavailable: ${errMsg(l7Action.reason)}`);
    if (access.status === "rejected") notes.push(`Access logs unavailable: ${errMsg(access.reason)}`);
    if (l7Cats.status === "rejected") notes.push(`Categories unavailable: ${errMsg(l7Cats.reason)}`);
    if (sources.gatewayL7 && joinInput.l7ByUserAction.length === 0) {
      notes.push("Gateway L7 returned no rows — is WARP deployed so requests carry identity?");
    }
    notes.push(
      "File-hash and bytes-transferred panels require Logpush (Enterprise tier) and are shown with demo data only. See docs/enterprise-r2-sql.md.",
    );

    if (zoneId) {
      const [zh, zf] = await Promise.allSettled([
        fetchZoneTopHosts(cfg.token, zoneId, win.start, win.end),
        fetchZoneFirewall(cfg.token, zoneId, win.start, win.end),
      ]);
      zone = {
        topHosts: zh.status === "fulfilled" ? zh.value : [],
        firewall: zf.status === "fulfilled" ? zf.value : [],
      };
      sources.zone = zh.status === "fulfilled" || zf.status === "fulfilled";
      if (zh.status === "rejected") notes.push(`Zone HTTP unavailable: ${errMsg(zh.reason)}`);
    }
  }

  const { users, distinctHosts, bytesSent, bytesReceived } = joinByIdentity(joinInput);

  const totals = {
    users: users.filter((u) => u.email !== "(unattributed)").length,
    requests: users.reduce((n, u) => n + u.requests.total, 0),
    allowed: users.reduce((n, u) => n + u.requests.allowed, 0),
    blocked: users.reduce((n, u) => n + u.requests.blocked, 0),
    bypass: users.reduce((n, u) => n + u.requests.bypass, 0),
    logins: users.reduce((n, u) => n + u.logins.total, 0),
    distinctHosts,
    bytesSent,
    bytesReceived,
  };

  const meta: ReportMeta = {
    generatedAt: new Date().toISOString(),
    windowStart: win.start.toISOString(),
    windowEnd: win.end.toISOString(),
    days: win.days,
    demo: cfg.demo,
    accountId,
    zoneId,
    sources,
    notes,
  };

  return { meta, totals, users, zone };
}
