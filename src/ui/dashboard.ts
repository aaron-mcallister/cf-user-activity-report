import type { Report } from "../cloudflare/types";
import { actionBar, escapeHtml, formatBytes, html, numberFmt, page, raw, SafeHtml } from "./layout";
import { searchBox } from "./search";

function sourceBadges(sources: Report["meta"]["sources"]): SafeHtml {
  const item = (on: boolean, label: string) =>
    `<span class="badge ${on ? "" : "src-off"}">${escapeHtml(label)}</span>`;
  return raw(
    [
      item(sources.gatewayL7, "Gateway HTTP"),
      item(sources.accessLogs, "Access logins"),
      item(sources.zone, "Zone WAF"),
      item(sources.categories, "Categories"),
      item(sources.files, "Files"),
      item(sources.sessions, "Bytes"),
    ].join(" "),
  );
}

function dateShort(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

export function renderDashboard(report: Report): string {
  const { meta, totals, users, zone } = report;
  const days = meta.days;

  const controls = html`
    <div class="controls">
      <span class="muted">Window:</span>
      ${[1, 7, 14, 30].map(
        (d) =>
          raw(
            `<a href="/?days=${d}" style="${d === days ? "border-color:var(--accent);color:var(--accent-ink)" : ""}">${d}d</a>`,
          ),
      )}
      <span style="flex:1"></span>
      <a href="/report.csv?days=${days}">⬇ CSV</a>
      <a href="/report.json?days=${days}">⬇ JSON</a>
      <a href="#" onclick="window.print();return false;">⬇ PDF</a>
      <a href="/preflight">Preflight</a>
    </div>`;

  const notes = meta.notes.length
    ? html`<div class="notes">${meta.notes.map((n) => raw(`<div>• ${escapeHtml(n)}</div>`))}</div>`
    : raw("");

  const blockedPct = totals.requests ? ((totals.blocked / totals.requests) * 100).toFixed(1) : "0.0";

  const cards = html`
    <div class="cards">
      <div class="card"><div class="k">Users</div><div class="v">${numberFmt(totals.users)}</div></div>
      <div class="card"><div class="k">Requests</div><div class="v">${numberFmt(totals.requests)}</div></div>
      <div class="card"><div class="k">Blocked</div><div class="v">${numberFmt(totals.blocked)}</div></div>
      <div class="card"><div class="k">% Blocked</div><div class="v">${blockedPct}%</div></div>
      <div class="card"><div class="k">Logins</div><div class="v">${numberFmt(totals.logins)}</div></div>
      <div class="card"><div class="k">↑ Uploaded</div><div class="v">${formatBytes(totals.bytesSent)}</div></div>
      <div class="card"><div class="k">↓ Downloaded</div><div class="v">${formatBytes(totals.bytesReceived)}</div></div>
    </div>`;

  const rows = users.length
    ? users.map((u) => {
        const top = u.topHosts[0];
        const href = `/user/${encodeURIComponent(u.email)}?days=${days}`;
        const worstCat = u.categories.find((c) => /malware|phishing/i.test(c.category));
        return html`<tr>
          <td>${raw(`<a class="email-link" href="${href}">${escapeHtml(u.email)}</a>`)}${worstCat ? raw(` <span class="pill blocked" title="${escapeHtml(worstCat.category)}">${escapeHtml(worstCat.category)}</span>`) : raw("")}</td>
          <td class="num">${u.deviceIds.length}</td>
          <td class="num">${numberFmt(u.requests.total)}</td>
          <td style="min-width:150px">${actionBar(u.requests)}</td>
          <td>${top ? html`${top.host} <span class="muted">(${numberFmt(top.count)})</span>` : raw('<span class="muted">—</span>')}</td>
          <td class="num" title="↑ ${escapeHtml(formatBytes(u.bytes.sent))} · ↓ ${escapeHtml(formatBytes(u.bytes.received))}">${raw(formatBytes(u.bytes.sent))} <span class="muted">↑</span></td>
          <td class="num">${numberFmt(u.logins.total)}</td>
        </tr>`;
      })
    : [html`<tr><td colspan="7" class="muted" style="padding:20px 16px">No user activity in this window.</td></tr>`];

  const usersPanel = html`
    <div class="panel">
      <h2>Users (${numberFmt(users.length)})</h2>
      <div class="legend">
        <span><i style="background:var(--ok)"></i>allowed</span>
        <span><i style="background:var(--bad)"></i>blocked</span>
        <span><i style="background:var(--bypass)"></i>bypass</span>
        <span><i style="background:var(--muted)"></i>other</span>
      </div>
      <div class="body">
        <table>
          <thead><tr>
            <th>User</th><th class="num">Devices</th><th class="num">Requests</th>
            <th>Traffic</th><th>Top destination</th><th class="num">Uploaded</th><th class="num">Logins</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;

  const zonePanel = zone
    ? html`
    <div class="panel">
      <h2>Zone — origin & WAF ${meta.zoneId ? raw(`<span class="muted" style="text-transform:none;font-weight:400"> · ${escapeHtml(meta.zoneId)}</span>`) : raw("")}</h2>
      <div class="body" style="display:grid;grid-template-columns:1fr 1fr;gap:0">
        <table>
          <thead><tr><th>Top host</th><th class="num">Requests</th></tr></thead>
          <tbody>${zone.topHosts.length ? zone.topHosts.map((h) => html`<tr><td>${h.host}</td><td class="num">${numberFmt(h.count)}</td></tr>`) : [raw('<tr><td class="muted" colspan="2" style="padding:16px">No zone HTTP data.</td></tr>')]}</tbody>
        </table>
        <table>
          <thead><tr><th>Firewall action</th><th class="num">Events</th></tr></thead>
          <tbody>${zone.firewall.length ? zone.firewall.map((f) => html`<tr><td>${f.action}</td><td class="num">${numberFmt(f.count)}</td></tr>`) : [raw('<tr><td class="muted" colspan="2" style="padding:16px">No firewall events.</td></tr>')]}</tbody>
        </table>
      </div>
    </div>`
    : raw("");

  const metabar = html`
    <div class="metabar">
      <span class="badge ${raw(meta.demo ? "demo" : "live")}">${meta.demo ? "DEMO DATA" : "LIVE"}</span>
      <span>${dateShort(meta.windowStart)} → ${dateShort(meta.windowEnd)} (${days}d)</span>
      <span>Sources: ${sourceBadges(meta.sources)}</span>
      <span>Generated ${escapeHtml(meta.generatedAt.slice(0, 19).replace("T", " "))}Z</span>
    </div>`;

  const body = html`${searchBox("", days)}${controls}${metabar}${notes}${cards}${usersPanel}${zonePanel}`;
  return page("User Activity Report", body);
}
