import type {
  AccessLogRow,
  CategoryRow,
  FileRow,
  GatewayL7Row,
  HostCount,
  SessionRow,
} from "./cloudflare/types";
import type { Window } from "./report/build";

// ---------------------------------------------------------------------------
// Synthetic demo data. Shaped exactly like the real Cloudflare API responses so
// demo mode exercises the same join + aggregation pipeline as live mode. No real
// people or traffic — safe to show publicly.
//
// The data is authored to tell a coherent threat-hunting story:
//   1. Search "malware"            -> a handful of users have Malware-category hits.
//   2. Open the top user (marcus)  -> he *allowed*-downloaded SecurityUpdate_v2.exe.
//   3. Search that file's hash     -> the same file is on 3 machines (lateral spread).
//   4. Search "Newly Seen Domains" -> tees up the RBI / isolation best-practice story.
// ---------------------------------------------------------------------------

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

/** The malware file at the center of the demo lateral-movement story. */
export const DEMO_MALWARE_HASH =
  "3aa1f2c4b9e07d5568a1c0d9f4e6b2a7c8d3e1f09a6b5c4d2e3f10987a6b5c4d";

const USERS = [
  { email: "alice.chen@acme-demo.com", userId: "u-1001", deviceId: "d-a1" },
  { email: "marcus.webb@acme-demo.com", userId: "u-1002", deviceId: "d-b2" },
  { email: "priya.nair@acme-demo.com", userId: "u-1003", deviceId: "d-c3" },
  { email: "diego.santos@acme-demo.com", userId: "u-1004", deviceId: "d-d4" },
  { email: "sofia.muller@acme-demo.com", userId: "u-1005", deviceId: "d-e5" },
  { email: "james.okoro@acme-demo.com", userId: "u-1006", deviceId: "d-f6" },
] as const;

/** Maps every demo host to a Gateway content/security category. */
const HOST_CATEGORY: Record<string, string> = {
  "github.com": "Technology",
  "google.com": "Search Engines",
  "youtube.com": "Streaming Media",
  "slack.com": "Business",
  "aws.amazon.com": "Technology",
  "stackoverflow.com": "Technology",
  "npmjs.com": "Technology",
  "salesforce.com": "Business",
  "linkedin.com": "Business",
  "figma.com": "Business",
  "notion.so": "Business",
  "grafana.com": "Technology",
  "dropbox.com": "File Sharing",
  "facebook.com": "Social Networking",
  "coinbase.com": "Cryptocurrency",
  "eicar.org": "Malware",
  "cdn-update-delivery.example": "Malware",
  "mirror-download.example": "Malware",
  "malware-test.example": "Malware",
  "phish-login.example": "Phishing",
  "secure-account-verify.example": "Phishing",
  "just-registered-x9z.example": "Newly Seen Domains",
  "brand-new-site.example": "Newly Seen Domains",
  "promo-lucky-winner.example": "Newly Seen Domains",
  "betting-pro.example": "Gambling",
  "poker-night.example": "Gambling",
  "adult-content.example": "Adult Themes",
  "torrent-search.example": "File Sharing",
  "cryptominer.example": "Cryptomining",
  "graymail-ads.example": "Advertisements",
};

type Action = "allow" | "block" | "bypass";

// [userIndex, host, action, count]
const TRAFFIC: [number, string, Action, number][] = [
  // alice — mostly clean, a little of everything
  [0, "github.com", "allow", 812], [0, "google.com", "allow", 540], [0, "slack.com", "allow", 288],
  [0, "aws.amazon.com", "allow", 205], [0, "coinbase.com", "bypass", 44], [0, "eicar.org", "block", 3],
  [0, "brand-new-site.example", "allow", 18], [0, "graymail-ads.example", "block", 12],
  // marcus — the compromised user: allowed malware download + newly seen domain
  [1, "google.com", "allow", 690], [1, "youtube.com", "allow", 512], [1, "slack.com", "allow", 240],
  [1, "cdn-update-delivery.example", "allow", 34], [1, "promo-lucky-winner.example", "allow", 22],
  [1, "facebook.com", "bypass", 96], [1, "poker-night.example", "block", 28],
  // priya — developer, hits a newly seen domain
  [2, "github.com", "allow", 733], [2, "stackoverflow.com", "allow", 410], [2, "npmjs.com", "allow", 355],
  [2, "aws.amazon.com", "allow", 262], [2, "just-registered-x9z.example", "allow", 40],
  [2, "torrent-search.example", "block", 41],
  // diego — has the malware file too, and a suspicious large upload
  [3, "salesforce.com", "allow", 520], [3, "google.com", "allow", 388], [3, "slack.com", "allow", 210],
  [3, "mirror-download.example", "allow", 27], [3, "betting-pro.example", "block", 33],
  [3, "phish-login.example", "block", 9],
  // sofia — malware download BLOCKED on her machine (nice contrast)
  [4, "figma.com", "allow", 615], [4, "google.com", "allow", 402], [4, "notion.so", "allow", 300],
  [4, "cdn-update-delivery.example", "block", 6], [4, "dropbox.com", "bypass", 60],
  [4, "adult-content.example", "block", 22],
  // james — phishing target
  [5, "github.com", "allow", 470], [5, "aws.amazon.com", "allow", 360], [5, "grafana.com", "allow", 244],
  [5, "secure-account-verify.example", "block", 14], [5, "cryptominer.example", "block", 17],
];

function rawTraffic() {
  return TRAFFIC.map(([ui, host, action, count]) => ({
    email: USERS[ui].email,
    userId: USERS[ui].userId,
    deviceId: USERS[ui].deviceId,
    host,
    action,
    count,
  }));
}

function groupL7ByUserAction(raw: ReturnType<typeof rawTraffic>): GatewayL7Row[] {
  const map = new Map<string, GatewayL7Row>();
  for (const r of raw) {
    const key = `${r.email}|${r.action}`;
    const existing = map.get(key);
    if (existing) existing.count += r.count;
    else
      map.set(key, {
        count: r.count,
        dimensions: { email: r.email, userId: r.userId, deviceId: r.deviceId, action: r.action },
      });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function groupL7ByHost(raw: ReturnType<typeof rawTraffic>): GatewayL7Row[] {
  const map = new Map<string, GatewayL7Row>();
  for (const r of raw) {
    const key = `${r.email}|${r.host}`;
    const existing = map.get(key);
    if (existing) existing.count += r.count;
    else map.set(key, { count: r.count, dimensions: { email: r.email, httpHost: r.host } });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** Derive per-user category tallies from the traffic table via HOST_CATEGORY. */
function deriveCategoryRows(raw: ReturnType<typeof rawTraffic>): CategoryRow[] {
  const map = new Map<string, CategoryRow>();
  for (const r of raw) {
    const category = HOST_CATEGORY[r.host] || "Uncategorized";
    const key = `${r.email}|${category}|${r.action}`;
    const existing = map.get(key);
    if (existing) existing.count += r.count;
    else
      map.set(key, {
        email: r.email,
        userId: r.userId,
        deviceId: r.deviceId,
        category,
        action: r.action,
        count: r.count,
      });
  }
  return [...map.values()];
}

/** File events — the malware file appears on three machines (lateral spread). */
function demoFileRows(win: Window): FileRow[] {
  const end = win.end.getTime();
  const when = (hoursAgo: number) => new Date(end - hoursAgo * 3_600_000).toISOString();
  return [
    // The lateral-movement story: same hash, three users, mixed outcomes.
    { email: USERS[1].email, userId: USERS[1].userId, deviceId: USERS[1].deviceId,
      fileName: "SecurityUpdate_v2.exe", fileHash: DEMO_MALWARE_HASH, action: "allow",
      host: "cdn-update-delivery.example", sizeBytes: 2.3 * MB, when: when(30) },
    { email: USERS[3].email, userId: USERS[3].userId, deviceId: USERS[3].deviceId,
      fileName: "SecurityUpdate_v2.exe", fileHash: DEMO_MALWARE_HASH, action: "allow",
      host: "mirror-download.example", sizeBytes: 2.3 * MB, when: when(22) },
    { email: USERS[4].email, userId: USERS[4].userId, deviceId: USERS[4].deviceId,
      fileName: "SecurityUpdate_v2.exe", fileHash: DEMO_MALWARE_HASH, action: "block",
      host: "cdn-update-delivery.example", sizeBytes: 2.3 * MB, when: when(12) },
    // Benign files for realism.
    { email: USERS[0].email, userId: USERS[0].userId, deviceId: USERS[0].deviceId,
      fileName: "Q3_report.pdf", fileHash: "9f2b7c1d0e5a4836b2c9d1e0f7a6b5c4d3e2f10987654321abcdef0123456789",
      action: "allow", host: "dropbox.com", sizeBytes: 4.1 * MB, when: when(40) },
    { email: USERS[3].email, userId: USERS[3].userId, deviceId: USERS[3].deviceId,
      fileName: "customer_export.csv", fileHash: "c1a2b3d4e5f60718293a4b5c6d7e8f9012345678abcdef1122334455667788aa",
      action: "allow", host: "salesforce.com", sizeBytes: 880 * KB, when: when(18) },
  ];
}

/** Session byte counters — diego shows a suspiciously large upload (exfil signal). */
const SESSION_BYTES: [number, number, number, number][] = [
  // [userIndex, bytesSent, bytesReceived, sessions]
  [0, 120 * MB, 890 * MB, 340],
  [1, 210 * MB, 1.2 * GB, 410],
  [2, 95 * MB, 620 * MB, 280],
  [3, 4.2 * GB, 300 * MB, 190], // large upload
  [4, 60 * MB, 410 * MB, 150],
  [5, 140 * MB, 720 * MB, 260],
];

function demoSessionRows(): SessionRow[] {
  return SESSION_BYTES.map(([ui, sent, received, sessions]) => ({
    email: USERS[ui].email,
    userId: USERS[ui].userId,
    deviceId: USERS[ui].deviceId,
    bytesSent: Math.round(sent),
    bytesReceived: Math.round(received),
    sessions,
  }));
}

const APPS = ["Internal Wiki", "Grafana", "AWS Console", "Salesforce", "Jenkins CI"];
const COUNTRIES = ["US", "US", "GB", "DE", "BR", "NG"];

function demoAccessLogs(win: Window): AccessLogRow[] {
  const rows: AccessLogRow[] = [];
  const endMs = win.end.getTime();
  USERS.forEach((u, i) => {
    const logins = 3 + (i % 4);
    for (let n = 0; n < logins; n++) {
      const app = APPS[(i + n) % APPS.length];
      const blocked = i === 3 && n === 0;
      rows.push({
        user_email: u.email,
        user_id: u.userId,
        app_name: app,
        app_domain: `${app.toLowerCase().replace(/[^a-z]+/g, "-")}.acme-demo.com`,
        app_type: "self_hosted",
        action: "login",
        allowed: !blocked,
        connection: "saml",
        ip_address: `203.0.113.${10 + i}`,
        country: COUNTRIES[i % COUNTRIES.length],
        created_at: new Date(endMs - (n * 7 + i) * 3_600_000).toISOString(),
        ray_id: `demo${i}${n}`,
      });
    }
  });
  return rows;
}

const ZONE_HOSTS: HostCount[] = [
  { host: "www.acme-demo.com", count: 4653 },
  { host: "api.acme-demo.com", count: 2210 },
  { host: "app.acme-demo.com", count: 1180 },
  { host: "blog.acme-demo.com", count: 640 },
];

const ZONE_FIREWALL = [
  { action: "managed_challenge", count: 318 },
  { action: "block", count: 142 },
  { action: "allow", count: 5904 },
  { action: "js_challenge", count: 76 },
];

export interface DemoData {
  l7ByUserAction: GatewayL7Row[];
  l7HostsByUser: GatewayL7Row[];
  accessLogs: AccessLogRow[];
  categoryRows: CategoryRow[];
  fileRows: FileRow[];
  sessionRows: SessionRow[];
  zoneTopHosts: HostCount[];
  zoneFirewall: { action: string; count: number }[];
}

export function getDemoData(win: Window): DemoData {
  const raw = rawTraffic();
  return {
    l7ByUserAction: groupL7ByUserAction(raw),
    l7HostsByUser: groupL7ByHost(raw),
    accessLogs: demoAccessLogs(win),
    categoryRows: deriveCategoryRows(raw),
    fileRows: demoFileRows(win),
    sessionRows: demoSessionRows(),
    zoneTopHosts: ZONE_HOSTS,
    zoneFirewall: ZONE_FIREWALL,
  };
}
