import type { AccessLogRow } from "./types";
import { CloudflareApiError } from "./graphql";

const REST_BASE = "https://api.cloudflare.com/client/v4";

/**
 * Fetch Access authentication logs (per-user login events).
 *
 * Endpoint: GET /accounts/{account_id}/access/logs/access_requests
 * Returns the most recent events (newest first). The endpoint caps how far back it
 * will return; we request a bounded page and filter client-side to the window.
 */
export async function fetchAccessLogs(
  token: string,
  accountId: string,
  start: Date,
  end: Date,
  limit = 1000,
): Promise<AccessLogRow[]> {
  const url = new URL(`${REST_BASE}/accounts/${accountId}/access/logs/access_requests`);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("direction", "desc");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  } catch (e) {
    throw new CloudflareApiError(`Network error calling Access logs API: ${String(e)}`);
  }
  const json = (await res.json().catch(() => null)) as any;
  if (!json?.success) {
    throw new CloudflareApiError(
      `Access logs API error (HTTP ${res.status})`,
      json?.errors,
    );
  }
  const rows: AccessLogRow[] = Array.isArray(json.result) ? json.result : [];
  const startMs = start.getTime();
  const endMs = end.getTime();
  return rows.filter((r) => {
    if (!r.created_at) return true;
    const t = Date.parse(r.created_at);
    return Number.isNaN(t) ? true : t >= startMs && t <= endMs;
  });
}
