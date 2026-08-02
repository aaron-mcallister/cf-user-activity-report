import type { Report } from "../cloudflare/types";
import type { SearchResult } from "../search/search";
import { RBI_LEARNING_PATH } from "../search/search";
import { escapeHtml, html, numberFmt, formatBytes, page, raw, SafeHtml } from "./layout";

function pillClass(action: string): string {
  const a = action.toLowerCase();
  if (a.startsWith("allow")) return "allowed";
  if (a.startsWith("block")) return "blocked";
  if (a.startsWith("bypass")) return "bypass";
  return "";
}

/** Reusable search box + quick pivots. Used on the dashboard and the search page. */
export function searchBox(query: string, days: number): SafeHtml {
  return html`
    <form class="search" action="/search" method="get" role="search">
      <input type="search" name="q" value="${query}" placeholder="Search a category (malware), a domain, a user, or a file hash…" autofocus>
      <input type="hidden" name="days" value="${days}">
      <button type="submit">Search</button>
    </form>
    <div class="chips-row">
      <span class="lbl">Try:</span>
      <a class="quick danger" href="/search?q=malware&days=${days}">malware</a>
      <a class="quick" href="/search?q=${raw(encodeURIComponent("Newly Seen Domains"))}&days=${days}">Newly Seen Domains</a>
      <a class="quick" href="/search?q=Phishing&days=${days}">Phishing</a>
      <a class="quick" href="/search?q=Gambling&days=${days}">Gambling</a>
    </div>`;
}

function dateTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 16).replace("T", " ") + "Z";
}

function userLink(email: string, days: number): SafeHtml {
  return raw(`<a class="email-link" href="/user/${encodeURIComponent(email)}?days=${days}">${escapeHtml(email)}</a>`);
}

function renderResult(result: SearchResult, days: number): SafeHtml {
  switch (result.kind) {
    case "category": {
      const reco = result.isolationRecommended
        ? html`<div class="callout">
            <h3>🛡️ Isolation recommended for “${result.category}”</h3>
            <div>Cloudflare's recommended HTTP policies suggest routing this category through
              <b>Remote Browser Isolation (RBI)</b> rather than allowing it outright — users can still
              reach the site, but it runs in an isolated browser so nothing executes locally.
              <a href="${raw(RBI_LEARNING_PATH)}" target="_blank" rel="noopener">See the recommended policy →</a></div>
          </div>`
        : raw("");
      const rows = result.users.length
        ? result.users.map(
            (u) => html`<tr>
              <td>${userLink(u.email, days)}</td>
              <td class="num">${numberFmt(u.count)}</td>
              <td class="num">${u.blocked ? raw(`<span class="pill blocked">${numberFmt(u.blocked)}</span>`) : raw('<span class="muted">0</span>')}</td>
            </tr>`,
          )
        : [raw('<tr><td colspan="3" class="muted" style="padding:16px">No users in this category.</td></tr>')];
      return html`
        ${reco}
        <div class="cards">
          <div class="card"><div class="k">Category</div><div class="v" style="font-size:20px">${result.category}</div></div>
          <div class="card"><div class="k">Total hits</div><div class="v">${numberFmt(result.totalHits)}</div></div>
          <div class="card"><div class="k">Blocked</div><div class="v">${numberFmt(result.blocked)}</div></div>
          <div class="card"><div class="k">Users</div><div class="v">${numberFmt(result.users.length)}</div></div>
        </div>
        <div class="panel">
          <h2>Users with “${result.category}” activity</h2>
          <div class="body"><table>
            <thead><tr><th>User</th><th class="num">Requests</th><th class="num">Blocked</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
        </div>`;
    }

    case "hash": {
      const machines = result.holders.length;
      const spread = machines > 1;
      const rows = result.holders.map(
        (h) => html`<tr>
          <td>${userLink(h.email, days)}</td>
          <td>${h.deviceIds.length ? h.deviceIds.map((d) => raw(`<span class="chip">${escapeHtml(d)}</span> `)) : raw('<span class="muted">—</span>')}</td>
          <td><span class="pill ${raw(pillClass(h.action))}">${h.action}</span></td>
          <td>${h.host || raw('<span class="muted">—</span>')}</td>
          <td>${formatBytes(h.sizeBytes)}</td>
          <td>${dateTime(h.when)}</td>
        </tr>`,
      );
      return html`
        ${spread
          ? html`<div class="callout" style="border-color:#fecaca;background:#fef2f2;color:#7f1d1d">
              <h3>⚠️ Potential lateral spread</h3>
              <div>This file hash was seen on <b class="spread-warn">${machines} machines</b>. Investigate whether it
                propagated across devices.</div>
            </div>`
          : raw("")}
        <div class="cards">
          <div class="card"><div class="k">File</div><div class="v" style="font-size:18px">${result.fileName || "(unknown)"}</div></div>
          <div class="card"><div class="k">Machines</div><div class="v">${numberFmt(machines)}</div></div>
        </div>
        <div class="panel"><div class="body" style="padding:12px 16px">
          <div class="muted" style="font-size:12px;margin-bottom:4px">SHA-256</div>
          <span class="mono">${result.fileHash}</span>
        </div></div>
        <div class="panel">
          <h2>Machines with this file</h2>
          <div class="body"><table>
            <thead><tr><th>User</th><th>Device(s)</th><th>Action</th><th>Source host</th><th>Size</th><th>When</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
        </div>`;
    }

    case "host": {
      const rows = result.users.length
        ? result.users.map(
            (u) => html`<tr><td>${userLink(u.email, days)}</td><td class="num">${numberFmt(u.count)}</td></tr>`,
          )
        : [raw('<tr><td colspan="2" class="muted" style="padding:16px">No users visited this host.</td></tr>')];
      return html`
        <div class="panel">
          <h2>Users who visited “${result.host}”</h2>
          <div class="body"><table>
            <thead><tr><th>User</th><th class="num">Requests</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
        </div>`;
    }

    case "text": {
      const section = (title: string, items: SafeHtml[]) =>
        items.length
          ? html`<div class="panel"><h2>${title}</h2><div class="body" style="padding:14px 16px"><div class="chips">${items}</div></div></div>`
          : raw("");
      return html`
        ${section("Users", result.users.map((e) => userLink(e, days)).map((l) => html`<span class="chip">${l}</span>`))}
        ${section("Categories", result.categories.map((c) => raw(`<a class="chip" href="/search?q=${encodeURIComponent(c)}&days=${days}">${escapeHtml(c)}</a>`)))}
        ${section("Hosts", result.hosts.map((h) => raw(`<a class="chip" href="/search?q=${encodeURIComponent(h)}&days=${days}">${escapeHtml(h)}</a>`)))}`;
    }

    default:
      return html`<div class="panel"><div class="body" style="padding:20px 16px">
        <p class="muted">No matches for “${result.query}”.</p>
        <p class="muted">Try a category (e.g. <a href="/search?q=malware&days=${days}">malware</a>), a domain, a user email, or a file hash.</p>
      </div></div>`;
  }
}

export function renderSearch(result: SearchResult, report: Report): string {
  const days = report.meta.days;
  const heading = result.query
    ? html`<div class="metabar" style="margin-top:6px"><span>Results for <b>“${result.query}”</b></span>
        <span class="badge ${raw(report.meta.demo ? "demo" : "live")}">${report.meta.demo ? "DEMO DATA" : "LIVE"}</span></div>`
    : raw("");
  const body = html`
    <div class="controls"><a href="/?days=${days}">← Dashboard</a></div>
    ${searchBox(result.query, days)}
    ${heading}
    ${renderResult(result, days)}`;
  return page(result.query ? `Search: ${result.query}` : "Search", body);
}
