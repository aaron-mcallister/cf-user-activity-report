// Shared types for the Cloudflare User Activity Report.

/** Worker environment: vars from wrangler.jsonc, secrets from `wrangler secret`, bindings. */
export interface Env {
  // --- secrets (set via `wrangler secret put ...`) ---
  CF_API_TOKEN?: string;
  BASIC_AUTH_USER?: string;
  BASIC_AUTH_PASS?: string;

  // --- vars (wrangler.jsonc [vars]) ---
  CF_ACCOUNT_ID?: string;
  CF_ZONE_ID?: string;
  DEMO_MODE?: string; // "auto" | "on" | "off"
  ALLOW_UNAUTHENTICATED?: string; // "true" | "false"

  // --- bindings (optional retention, off by default) ---
  ACTIVITY_BUCKET?: R2Bucket;
}

/** One grouped row from gatewayL7RequestsAdaptiveGroups. */
export interface GatewayL7Row {
  count: number;
  dimensions: {
    email?: string;
    userId?: string;
    deviceId?: string;
    action?: string;
    httpHost?: string;
  };
}

/** One record from the Access authentication logs REST endpoint. */
export interface AccessLogRow {
  user_email?: string;
  user_id?: string;
  app_name?: string;
  app_domain?: string;
  app_type?: string;
  action?: string;
  allowed?: boolean;
  connection?: string;
  ip_address?: string;
  country?: string;
  created_at?: string;
  ray_id?: string;
}

// --- Raw rows fed into the identity join (from fixtures or, later, live queries) ---

export interface CategoryRow {
  email?: string;
  userId?: string;
  deviceId?: string;
  category: string;
  action?: string;
  count: number;
}

export interface FileRow {
  email?: string;
  userId?: string;
  deviceId?: string;
  fileName: string;
  fileHash: string;
  action?: string;
  host?: string;
  sizeBytes?: number;
  when?: string;
}

export interface SessionRow {
  email?: string;
  userId?: string;
  deviceId?: string;
  bytesSent: number;
  bytesReceived: number;
  sessions: number;
}

export interface HostCount {
  host: string;
  count: number;
}

export interface AppCount {
  app: string;
  count: number;
}

/** A category tally for a user (e.g. Malware, Newly Seen Domains). */
export interface CategoryHit {
  category: string;
  count: number;
  allowed: number;
  blocked: number;
}

/** A file seen for a user (downloaded/blocked), keyed by hash. */
export interface FileEvent {
  fileName: string;
  fileHash: string;
  action: string;
  host: string;
  sizeBytes: number;
  when?: string;
}

/** Upload/download volume for a user (from network session telemetry). */
export interface SessionBytes {
  sent: number;
  received: number;
  sessions: number;
}

/** Per-user rollup — the heart of the report. */
export interface UserActivity {
  email: string;
  userId?: string;
  deviceIds: string[];
  requests: {
    total: number;
    allowed: number;
    blocked: number;
    bypass: number;
    other: number;
  };
  topHosts: HostCount[];
  categories: CategoryHit[];
  files: FileEvent[];
  bytes: SessionBytes;
  logins: {
    total: number;
    apps: AppCount[];
    lastLogin?: string;
    countries: string[];
    blocked: number;
  };
}

export interface ReportMeta {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  days: number;
  demo: boolean;
  accountId: string;
  zoneId?: string;
  sources: { gatewayL7: boolean; accessLogs: boolean; zone: boolean; categories: boolean; files: boolean; sessions: boolean };
  notes: string[];
}

export interface ZoneRollup {
  topHosts: HostCount[];
  firewall: { action: string; count: number }[];
}

export interface Report {
  meta: ReportMeta;
  totals: {
    users: number;
    requests: number;
    allowed: number;
    blocked: number;
    bypass: number;
    logins: number;
    distinctHosts: number;
    bytesSent: number;
    bytesReceived: number;
  };
  users: UserActivity[];
  zone?: ZoneRollup;
}
