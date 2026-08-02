import type { CategoryRow, GatewayL7Row, HostCount } from "./types";

const GQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const REST_BASE = "https://api.cloudflare.com/client/v4";

export class CloudflareApiError extends Error {
  constructor(message: string, readonly detail?: unknown) {
    super(message);
    this.name = "CloudflareApiError";
  }
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/** Run a GraphQL query. Throws CloudflareApiError on transport or GraphQL errors. */
export async function gql<T = any>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(GQL_ENDPOINT, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new CloudflareApiError(`Network error calling GraphQL API: ${String(e)}`);
  }
  const json = (await res.json().catch(() => null)) as any;
  if (!json) throw new CloudflareApiError(`GraphQL API returned non-JSON (HTTP ${res.status})`);
  if (Array.isArray(json.errors) && json.errors.length) {
    throw new CloudflareApiError(json.errors[0]?.message || "GraphQL error", json.errors);
  }
  return json.data as T;
}

/** List accounts visible to the token; used for auto-discovery. */
export async function listAccounts(token: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`${REST_BASE}/accounts?per_page=50`, { headers: authHeaders(token) });
  const json = (await res.json().catch(() => null)) as any;
  if (!json?.success) throw new CloudflareApiError("Could not list accounts", json?.errors);
  return (json.result || []).map((a: any) => ({ id: a.id, name: a.name }));
}

/** Resolve the account id: explicit value wins, otherwise auto-discover if exactly one. */
export async function resolveAccountId(token: string, provided?: string): Promise<string> {
  if (provided) return provided;
  const accounts = await listAccounts(token);
  if (accounts.length === 1) return accounts[0].id;
  if (accounts.length === 0) throw new CloudflareApiError("Token can see no accounts; set CF_ACCOUNT_ID.");
  throw new CloudflareApiError(
    `Token sees ${accounts.length} accounts; set CF_ACCOUNT_ID to disambiguate.`,
  );
}

const ISO = (d: Date) => d.toISOString();

/**
 * Per-user Gateway HTTP (L7) activity grouped by identity + action.
 * This is the confirmed free-tier, per-user web activity source (requires WARP so
 * identity is attached to requests).
 */
export async function fetchGatewayL7ByUserAction(
  token: string,
  accountId: string,
  start: Date,
  end: Date,
  limit = 10_000,
): Promise<GatewayL7Row[]> {
  const query = `
    query($account: String!, $start: Time!, $end: Time!, $limit: Int!) {
      viewer {
        accounts(filter: { accountTag: $account }) {
          gatewayL7RequestsAdaptiveGroups(
            limit: $limit
            filter: { datetime_geq: $start, datetime_leq: $end }
            orderBy: [count_DESC]
          ) {
            count
            dimensions { email userId deviceId action }
          }
        }
      }
    }`;
  const data = await gql(token, query, {
    account: accountId,
    start: ISO(start),
    end: ISO(end),
    limit,
  });
  return data?.viewer?.accounts?.[0]?.gatewayL7RequestsAdaptiveGroups ?? [];
}

/** Per-user top destination hosts (grouped by email + httpHost). */
export async function fetchGatewayL7HostsByUser(
  token: string,
  accountId: string,
  start: Date,
  end: Date,
  limit = 10_000,
): Promise<GatewayL7Row[]> {
  const query = `
    query($account: String!, $start: Time!, $end: Time!, $limit: Int!) {
      viewer {
        accounts(filter: { accountTag: $account }) {
          gatewayL7RequestsAdaptiveGroups(
            limit: $limit
            filter: { datetime_geq: $start, datetime_leq: $end }
            orderBy: [count_DESC]
          ) {
            count
            dimensions { email httpHost }
          }
        }
      }
    }`;
  const data = await gql(token, query, {
    account: accountId,
    start: ISO(start),
    end: ISO(end),
    limit,
  });
  return data?.viewer?.accounts?.[0]?.gatewayL7RequestsAdaptiveGroups ?? [];
}

/**
 * Per-user content/security categories from Gateway HTTP (L7). `categoryNames` is a
 * list dimension, so each group row carries an array of categories; we explode it into
 * one CategoryRow per (user, category) so the join can tally per-category activity.
 * Confirmed available on the free GraphQL path.
 */
export async function fetchGatewayL7CategoriesByUser(
  token: string,
  accountId: string,
  start: Date,
  end: Date,
  limit = 10_000,
): Promise<CategoryRow[]> {
  const query = `
    query($account: String!, $start: Time!, $end: Time!, $limit: Int!) {
      viewer {
        accounts(filter: { accountTag: $account }) {
          gatewayL7RequestsAdaptiveGroups(
            limit: $limit
            filter: { datetime_geq: $start, datetime_leq: $end }
            orderBy: [count_DESC]
          ) {
            count
            dimensions { email action categoryNames }
          }
        }
      }
    }`;
  const data = await gql(token, query, {
    account: accountId,
    start: ISO(start),
    end: ISO(end),
    limit,
  });
  const rows = data?.viewer?.accounts?.[0]?.gatewayL7RequestsAdaptiveGroups ?? [];
  const out: CategoryRow[] = [];
  for (const r of rows) {
    const cats: string[] = Array.isArray(r.dimensions?.categoryNames) ? r.dimensions.categoryNames : [];
    for (const category of cats) {
      if (!category) continue;
      out.push({
        email: r.dimensions.email,
        action: r.dimensions.action,
        category,
        count: r.count,
      });
    }
  }
  return out;
}

/** Zone origin HTTP: top requested hosts. */
export async function fetchZoneTopHosts(
  token: string,
  zoneId: string,
  start: Date,
  end: Date,
  limit = 25,
): Promise<HostCount[]> {
  const query = `
    query($zone: String!, $start: Time!, $end: Time!, $limit: Int!) {
      viewer {
        zones(filter: { zoneTag: $zone }) {
          httpRequestsAdaptiveGroups(
            limit: $limit
            filter: { datetime_geq: $start, datetime_leq: $end }
            orderBy: [count_DESC]
          ) {
            count
            dimensions { clientRequestHTTPHost }
          }
        }
      }
    }`;
  const data = await gql(token, query, { zone: zoneId, start: ISO(start), end: ISO(end), limit });
  const rows = data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? [];
  return rows.map((r: any) => ({ host: r.dimensions.clientRequestHTTPHost || "(unknown)", count: r.count }));
}

/** Zone WAF / firewall events grouped by action. */
export async function fetchZoneFirewall(
  token: string,
  zoneId: string,
  start: Date,
  end: Date,
  limit = 25,
): Promise<{ action: string; count: number }[]> {
  const query = `
    query($zone: String!, $start: Time!, $end: Time!, $limit: Int!) {
      viewer {
        zones(filter: { zoneTag: $zone }) {
          firewallEventsAdaptiveGroups(
            limit: $limit
            filter: { datetime_geq: $start, datetime_leq: $end }
            orderBy: [count_DESC]
          ) {
            count
            dimensions { action }
          }
        }
      }
    }`;
  const data = await gql(token, query, { zone: zoneId, start: ISO(start), end: ISO(end), limit });
  const rows = data?.viewer?.zones?.[0]?.firewallEventsAdaptiveGroups ?? [];
  return rows.map((r: any) => ({ action: r.dimensions.action || "(unknown)", count: r.count }));
}
