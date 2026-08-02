import type {
  AccessLogRow,
  CategoryRow,
  FileRow,
  GatewayL7Row,
  SessionRow,
  UserActivity,
} from "../cloudflare/types";
import { bump, classifyAction, normEmail, topN } from "./aggregate";

export interface JoinInput {
  l7ByUserAction: GatewayL7Row[];
  l7HostsByUser: GatewayL7Row[];
  accessLogs: AccessLogRow[];
  categoryRows: CategoryRow[];
  fileRows: FileRow[];
  sessionRows: SessionRow[];
}

export interface JoinResult {
  users: UserActivity[];
  distinctHosts: number;
  bytesSent: number;
  bytesReceived: number;
}

/**
 * Correlate Gateway HTTP activity, category tallies, file events, session bytes, and
 * Access login activity into one per-user view, keyed on user identity (email, with
 * userId/deviceId carried along). This in-app correlation across datasets is exactly
 * what Log Explorer cannot do today.
 */
export function joinByIdentity(input: JoinInput): JoinResult {
  const users = new Map<string, UserActivity>();
  const hostByUser = new Map<string, Map<string, number>>();
  const appByUser = new Map<string, Map<string, number>>();
  const countryByUser = new Map<string, Set<string>>();
  const catByUser = new Map<string, Map<string, { count: number; allowed: number; blocked: number }>>();
  const fileByUser = new Map<string, Map<string, FileRow>>();
  const globalHosts = new Set<string>();
  let bytesSent = 0;
  let bytesReceived = 0;

  const getUser = (email?: string, userId?: string): UserActivity => {
    const key = normEmail(email);
    let u = users.get(key);
    if (!u) {
      u = {
        email: email?.trim() || "(unattributed)",
        userId,
        deviceIds: [],
        requests: { total: 0, allowed: 0, blocked: 0, bypass: 0, other: 0 },
        topHosts: [],
        categories: [],
        files: [],
        bytes: { sent: 0, received: 0, sessions: 0 },
        logins: { total: 0, apps: [], countries: [], blocked: 0 },
      };
      users.set(key, u);
    }
    if (userId && !u.userId) u.userId = userId;
    return u;
  };

  const addDevice = (u: UserActivity, deviceId?: string) => {
    if (deviceId && !u.deviceIds.includes(deviceId)) u.deviceIds.push(deviceId);
  };

  // --- Gateway HTTP requests, grouped by identity + action ---
  for (const row of input.l7ByUserAction) {
    const d = row.dimensions;
    const u = getUser(d.email, d.userId);
    addDevice(u, d.deviceId);
    u.requests.total += row.count;
    u.requests[classifyAction(d.action)] += row.count;
  }

  // --- Gateway HTTP requests, grouped by identity + host (for top destinations) ---
  for (const row of input.l7HostsByUser) {
    const d = row.dimensions;
    if (!d.httpHost) continue;
    globalHosts.add(d.httpHost);
    const key = normEmail(d.email);
    if (!hostByUser.has(key)) hostByUser.set(key, new Map());
    bump(hostByUser.get(key)!, d.httpHost, row.count);
    getUser(d.email);
  }

  // --- Category tallies, grouped by identity + category + action ---
  for (const row of input.categoryRows) {
    const u = getUser(row.email, row.userId);
    addDevice(u, row.deviceId);
    const key = normEmail(row.email);
    if (!catByUser.has(key)) catByUser.set(key, new Map());
    const m = catByUser.get(key)!;
    const cur = m.get(row.category) || { count: 0, allowed: 0, blocked: 0 };
    cur.count += row.count;
    const cls = classifyAction(row.action);
    if (cls === "blocked") cur.blocked += row.count;
    else cur.allowed += row.count;
    m.set(row.category, cur);
  }

  // --- File events, grouped by identity, deduped per (hash+host+action) ---
  for (const row of input.fileRows) {
    const u = getUser(row.email, row.userId);
    addDevice(u, row.deviceId);
    const key = normEmail(row.email);
    if (!fileByUser.has(key)) fileByUser.set(key, new Map());
    const dedupe = `${row.fileHash}|${row.host || ""}|${row.action || ""}`;
    if (!fileByUser.get(key)!.has(dedupe)) fileByUser.get(key)!.set(dedupe, row);
  }

  // --- Session byte counters, grouped by identity ---
  for (const row of input.sessionRows) {
    const u = getUser(row.email, row.userId);
    addDevice(u, row.deviceId);
    u.bytes.sent += row.bytesSent;
    u.bytes.received += row.bytesReceived;
    u.bytes.sessions += row.sessions;
    bytesSent += row.bytesSent;
    bytesReceived += row.bytesReceived;
  }

  // --- Access authentication logs, grouped by identity ---
  for (const log of input.accessLogs) {
    const u = getUser(log.user_email, log.user_id);
    const key = normEmail(log.user_email);
    u.logins.total += 1;
    if (log.allowed === false) u.logins.blocked += 1;
    if (log.app_name) {
      if (!appByUser.has(key)) appByUser.set(key, new Map());
      bump(appByUser.get(key)!, log.app_name, 1);
    }
    if (log.country) {
      if (!countryByUser.has(key)) countryByUser.set(key, new Set());
      countryByUser.get(key)!.add(log.country);
    }
    if (log.created_at) {
      if (!u.logins.lastLogin || Date.parse(log.created_at) > Date.parse(u.logins.lastLogin)) {
        u.logins.lastLogin = log.created_at;
      }
    }
  }

  // --- finalise per-user rollups ---
  for (const [key, u] of users) {
    const hosts = hostByUser.get(key);
    if (hosts) u.topHosts = topN(hosts, 10).map((h) => ({ host: h.label, count: h.count }));

    const cats = catByUser.get(key);
    if (cats) {
      u.categories = [...cats.entries()]
        .map(([category, v]) => ({ category, count: v.count, allowed: v.allowed, blocked: v.blocked }))
        .sort((a, b) => b.count - a.count);
    }

    const files = fileByUser.get(key);
    if (files) {
      u.files = [...files.values()]
        .map((f) => ({
          fileName: f.fileName,
          fileHash: f.fileHash,
          action: f.action || "unknown",
          host: f.host || "",
          sizeBytes: f.sizeBytes || 0,
          when: f.when,
        }))
        .sort((a, b) => (b.when || "").localeCompare(a.when || ""));
    }

    const apps = appByUser.get(key);
    if (apps) u.logins.apps = topN(apps, 10).map((a) => ({ app: a.label, count: a.count }));
    const countries = countryByUser.get(key);
    if (countries) u.logins.countries = [...countries].sort();
  }

  const sorted = [...users.values()].sort((a, b) => b.requests.total - a.requests.total);
  return { users: sorted, distinctHosts: globalHosts.size, bytesSent, bytesReceived };
}
