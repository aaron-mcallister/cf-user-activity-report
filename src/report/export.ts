import type { Report } from "../cloudflare/types";

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Flatten the per-user report into CSV (one row per user). */
export function reportToCsv(report: Report): string {
  const header = [
    "email",
    "user_id",
    "device_count",
    "requests_total",
    "requests_allowed",
    "requests_blocked",
    "requests_bypass",
    "requests_other",
    "top_host",
    "top_host_count",
    "logins_total",
    "logins_blocked",
    "last_login",
    "countries",
  ];
  const lines = [header.join(",")];
  for (const u of report.users) {
    const top = u.topHosts[0];
    lines.push(
      [
        u.email,
        u.userId ?? "",
        u.deviceIds.length,
        u.requests.total,
        u.requests.allowed,
        u.requests.blocked,
        u.requests.bypass,
        u.requests.other,
        top?.host ?? "",
        top?.count ?? "",
        u.logins.total,
        u.logins.blocked,
        u.logins.lastLogin ?? "",
        u.logins.countries.join("|"),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}
