import type { Env } from "./cloudflare/types";

export interface ResolvedConfig {
  token?: string;
  accountId?: string;
  zoneId?: string;
  /** True = serve synthetic demo data instead of calling the Cloudflare API. */
  demo: boolean;
  /** True = allow serving live (PII) data with no app-layer auth. Not recommended. */
  allowUnauthenticated: boolean;
  basicAuth?: { user: string; pass: string };
}

/**
 * Resolve runtime configuration from the Worker env.
 *
 * DEMO_MODE:
 *   "on"   -> always demo data
 *   "off"  -> always live data (requires CF_API_TOKEN)
 *   "auto" -> demo when no token is present, live when it is (default)
 */
export function resolveConfig(env: Env): ResolvedConfig {
  const token = env.CF_API_TOKEN?.trim() || undefined;
  const mode = (env.DEMO_MODE || "auto").toLowerCase();
  const demo = mode === "on" ? true : mode === "off" ? false : !token;

  const basicAuth =
    env.BASIC_AUTH_USER && env.BASIC_AUTH_PASS
      ? { user: env.BASIC_AUTH_USER, pass: env.BASIC_AUTH_PASS }
      : undefined;

  return {
    token,
    accountId: env.CF_ACCOUNT_ID?.trim() || undefined,
    zoneId: env.CF_ZONE_ID?.trim() || undefined,
    demo,
    allowUnauthenticated: (env.ALLOW_UNAUTHENTICATED || "false").toLowerCase() === "true",
    basicAuth,
  };
}

/** Parse the reporting window from the query string. Defaults to last 7 days. */
export function resolveWindow(url: URL): { start: Date; end: Date; days: number } {
  const end = new Date();
  let days = parseInt(url.searchParams.get("days") || "7", 10);
  if (!Number.isFinite(days) || days < 1) days = 7;
  // Gateway/Zero Trust analytics retention caps at ~30 days on this data path.
  if (days > 30) days = 30;
  const start = new Date(end.getTime() - days * 86_400_000);
  return { start, end, days };
}
