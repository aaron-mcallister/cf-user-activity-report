import type { Report, UserActivity } from "../cloudflare/types";
import { actionBar, escapeHtml, formatBytes, html, numberFmt, page, raw, SafeHtml } from "./layout";

function dateTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 16).replace("T", " ") + "Z";
}

function pillClass(action: string): string {
  const a = action.toLowerCase();
  if (a.startsWith("allow")) return "allowed";
  if (a.startsWith("block")) return "blocked";
  if (a.startsWith("bypass")) return "bypass";
  return "";
}

export function renderUser(user: UserActivity, meta: Report["meta"]): string {
  const days = meta.days;
  const back = html`<div class="controls"><a href="/?days=${days}">← All users</a>
    <span style="flex:1"></span>
    <a href="/report.csv?days=${days}">⬇ CSV (all)</a>
    <a href="#" onclick="window.print();return false;">⬇ PDF</a></div>`;

  const header = html`
    <div class="panel">
      <h2>User detail</h2>
      <div class="body" style="padding:16px">
        <div style="font-size:20px;font-weight:700">${user.email}</div>
        <div class="muted" style="margin-top:4px">
          ${user.userId ? html`User ID: ${user.userId} · ` : raw("")}
          Devices: ${user.deviceIds.length}
        </div>
        ${user.deviceIds.length
          ? html`<div class="chips" style="margin-top:10px">${user.deviceIds.map((d) => raw(`<span class="chip">${escapeHtml(d)}</span>`))}</div>`
          : raw("")}
      </div>
    </div>`;

  const r = user.requests;
  const cards = html`
    <div class="cards">
      <div class="card"><div class="k">Requests</div><div class="v">${numberFmt(r.total)}</div></div>
      <div class="card"><div class="k">Allowed</div><div class="v">${numberFmt(r.allowed)}</div></div>
      <div class="card"><div class="k">Blocked</div><div class="v">${numberFmt(r.blocked)}</div></div>
      <div class="card"><div class="k">↑ Uploaded</div><div class="v">${formatBytes(user.bytes.sent)}</div></div>
      <div class="card"><div class="k">↓ Downloaded</div><div class="v">${formatBytes(user.bytes.received)}</div></div>
    </div>`;

  const trafficPanel = html`
    <div class="panel">
      <h2>Web traffic breakdown</h2>
      <div class="legend">
        <span><i style="background:var(--ok)"></i>allowed ${numberFmt(r.allowed)}</span>
        <span><i style="background:var(--bad)"></i>blocked ${numberFmt(r.blocked)}</span>
        <span><i style="background:var(--bypass)"></i>bypass ${numberFmt(r.bypass)}</span>
        <span><i style="background:var(--muted)"></i>other ${numberFmt(r.other)}</span>
      </div>
      <div class="body" style="padding:0 16px 16px">${actionBar(r)}</div>
    </div>`;

  const catRows: SafeHtml[] = user.categories.length
    ? user.categories.map(
        (c) => html`<tr>
          <td><a class="email-link" href="/search?q=${raw(encodeURIComponent(c.category))}&days=${days}">${c.category}</a></td>
          <td class="num">${numberFmt(c.count)}</td>
          <td class="num">${c.blocked ? raw(`<span class="pill blocked">${numberFmt(c.blocked)}</span>`) : raw('<span class="muted">0</span>')}</td>
        </tr>`,
      )
    : [raw('<tr><td class="muted" colspan="3" style="padding:16px">No category data (demo-only for now).</td></tr>')];

  const categoriesPanel = html`
    <div class="panel">
      <h2>Activity by category</h2>
      <div class="body"><table>
        <thead><tr><th>Category</th><th class="num">Requests</th><th class="num">Blocked</th></tr></thead>
        <tbody>${catRows}</tbody>
      </table></div>
    </div>`;

  const fileRows: SafeHtml[] = user.files.length
    ? user.files.map(
        (f) => html`<tr>
          <td>${f.fileName}</td>
          <td><a class="hash-link" href="/search?q=${raw(encodeURIComponent(f.fileHash))}&days=${days}" title="Search this hash across all machines"><span class="mono">${raw(escapeHtml(f.fileHash.slice(0, 16)))}…</span></a></td>
          <td><span class="pill ${raw(pillClass(f.action))}">${f.action}</span></td>
          <td>${f.host || raw('<span class="muted">—</span>')}</td>
          <td>${formatBytes(f.sizeBytes)}</td>
          <td>${dateTime(f.when)}</td>
        </tr>`,
      )
    : [raw('<tr><td class="muted" colspan="6" style="padding:16px">No file events (demo-only for now).</td></tr>')];

  const filesPanel = html`
    <div class="panel">
      <h2>Files ${user.files.length ? raw(`<span class="muted" style="text-transform:none;font-weight:400"> · click a hash to trace it across machines</span>`) : raw("")}</h2>
      <div class="body"><table>
        <thead><tr><th>File</th><th>SHA-256</th><th>Action</th><th>Source host</th><th>Size</th><th>When</th></tr></thead>
        <tbody>${fileRows}</tbody>
      </table></div>
    </div>`;

  const hostRows: SafeHtml[] = user.topHosts.length
    ? user.topHosts.map(
        (h) => html`<tr><td>${h.host}</td><td class="num">${numberFmt(h.count)}</td></tr>`,
      )
    : [raw('<tr><td class="muted" colspan="2" style="padding:16px">No destinations recorded.</td></tr>')];

  const hostsPanel = html`
    <div class="panel">
      <h2>Top destinations</h2>
      <div class="body">
        <table><thead><tr><th>Host</th><th class="num">Requests</th></tr></thead>
        <tbody>${hostRows}</tbody></table>
      </div>
    </div>`;

  const appRows: SafeHtml[] = user.logins.apps.length
    ? user.logins.apps.map(
        (a) => html`<tr><td>${a.app}</td><td class="num">${numberFmt(a.count)}</td></tr>`,
      )
    : [raw('<tr><td class="muted" colspan="2" style="padding:16px">No Access logins in window.</td></tr>')];

  const loginPanel = html`
    <div class="panel">
      <h2>Access logins</h2>
      <div class="body" style="padding:12px 16px">
        <div class="metabar" style="margin:0 0 8px">
          <span>Total: <b>${numberFmt(user.logins.total)}</b></span>
          <span>Blocked: <b>${numberFmt(user.logins.blocked)}</b></span>
          <span>Last: <b>${dateTime(user.logins.lastLogin)}</b></span>
          ${user.logins.countries.length
            ? html`<span>Countries: ${user.logins.countries.map((c) => raw(`<span class="chip">${escapeHtml(c)}</span> `))}</span>`
            : raw("")}
        </div>
        <table><thead><tr><th>Application</th><th class="num">Logins</th></tr></thead>
        <tbody>${appRows}</tbody></table>
      </div>
    </div>`;

  const body = html`${back}${header}${cards}${trafficPanel}${categoriesPanel}${filesPanel}${hostsPanel}${loginPanel}`;
  return page(`${user.email} · User Activity`, body);
}
