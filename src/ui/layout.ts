// Tiny, dependency-free HTML templating with automatic escaping.

export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

/** Mark a string as already-safe HTML (do not escape). */
export function raw(s: string): SafeHtml {
  return new SafeHtml(s);
}

export function escapeHtml(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

/** Tagged template that escapes interpolations. SafeHtml and arrays pass through. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = "";
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) {
      const v = values[i];
      if (v instanceof SafeHtml) out += v.value;
      else if (Array.isArray(v)) out += v.map((x) => (x instanceof SafeHtml ? x.value : escapeHtml(x))).join("");
      else out += escapeHtml(v);
    }
  });
  return new SafeHtml(out);
}

const STYLES = `
:root {
  --bg: #f6f7f9; --panel: #ffffff; --ink: #1d1f24; --muted: #6b7280;
  --line: #e5e7eb; --accent: #f6821f; --accent-ink: #b45309;
  --ok: #16a34a; --warn: #d97706; --bad: #dc2626; --bypass: #6366f1;
  --radius: 12px; --shadow: 0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.1);
}
@media (prefers-color-scheme: dark) {
  :root { --bg:#0f1115; --panel:#171a21; --ink:#e6e8ec; --muted:#9aa1ac;
    --line:#262b34; --shadow:none; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
a { color: inherit; }
.wrap { max-width: 1100px; margin: 0 auto; padding: 24px 20px 64px; }
header.app { display: flex; align-items: center; gap: 14px; margin-bottom: 6px; }
header.app .mark { width: 34px; height: 34px; border-radius: 8px; flex: none;
  background: linear-gradient(135deg, var(--accent), #fbbf24); }
header.app h1 { font-size: 20px; margin: 0; letter-spacing: -.01em; }
header.app .sub { color: var(--muted); font-size: 13px; }
.metabar { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center;
  color: var(--muted); font-size: 13px; margin: 14px 0 20px; }
.badge { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px;
  font-weight: 600; border: 1px solid var(--line); }
.badge.demo { background: #fff7ed; color: var(--accent-ink); border-color: #fed7aa; }
.badge.live { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
.badge.src-off { opacity: .45; text-decoration: line-through; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px; margin-bottom: 22px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 14px 16px; box-shadow: var(--shadow); }
.card .k { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
.card .v { font-size: 26px; font-weight: 700; margin-top: 4px; letter-spacing: -.02em; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
  box-shadow: var(--shadow); margin-bottom: 20px; overflow: hidden; }
.panel h2 { font-size: 14px; margin: 0; padding: 13px 16px; border-bottom: 1px solid var(--line);
  text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
.panel .body { padding: 4px 0; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 10px 16px; border-bottom: 1px solid var(--line); }
th { font-size: 12px; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); font-weight: 600; }
tr:last-child td { border-bottom: none; }
tbody tr:hover { background: rgba(246,130,31,.05); }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.bar { display: flex; height: 8px; border-radius: 999px; overflow: hidden; background: var(--line); min-width: 120px; }
.bar > span { display: block; height: 100%; }
.seg-allowed { background: var(--ok); }
.seg-blocked { background: var(--bad); }
.seg-bypass { background: var(--bypass); }
.seg-other { background: var(--muted); }
.legend { display: flex; gap: 14px; flex-wrap: wrap; color: var(--muted); font-size: 12px; margin: 2px 16px 12px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: middle; }
.controls { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 0 0 18px; }
.controls a, .controls .btn { text-decoration: none; font-size: 13px; font-weight: 600;
  padding: 7px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
.controls a:hover { border-color: var(--accent); }
.pill { font-size: 12px; padding: 2px 8px; border-radius: 6px; font-weight: 600; }
.pill.allowed { background: #ecfdf5; color: #047857; }
.pill.blocked { background: #fef2f2; color: #b91c1c; }
.pill.bypass { background: #eef2ff; color: #4338ca; }
.notes { margin: 0 0 18px; padding: 12px 14px; border-left: 3px solid var(--accent);
  background: #fff7ed; color: #7c2d12; border-radius: 8px; font-size: 13px; }
@media (prefers-color-scheme: dark) { .notes { background: #2a1c0f; color: #fdba74; }
  .badge.demo { background: #2a1c0f; } .pill.allowed{background:#0b2a1c;} .pill.blocked{background:#2a0f0f;} .pill.bypass{background:#171a2a;} }
.muted { color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font-size: 12px; padding: 2px 8px; border: 1px solid var(--line); border-radius: 999px; }
footer.app { color: var(--muted); font-size: 12px; margin-top: 28px; text-align: center; }
.email-link { font-weight: 600; text-decoration: none; }
.email-link:hover { color: var(--accent-ink); text-decoration: underline; }
.search { display: flex; gap: 8px; margin: 4px 0 14px; }
.search input[type=search] { flex: 1; padding: 11px 14px; font-size: 15px; border: 1px solid var(--line);
  border-radius: 10px; background: var(--panel); color: var(--ink); }
.search input[type=search]:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(246,130,31,.15); }
.search button { padding: 0 18px; font-size: 14px; font-weight: 600; border: none; border-radius: 10px;
  background: var(--accent); color: #fff; cursor: pointer; }
.chips-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 18px; }
.chips-row .lbl { color: var(--muted); font-size: 12px; }
.quick { text-decoration: none; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--panel); }
.quick:hover { border-color: var(--accent); color: var(--accent-ink); }
.quick.danger { border-color: #fecaca; background: #fef2f2; color: #b91c1c; }
.callout { margin: 0 0 20px; padding: 14px 16px; border-radius: 12px; border: 1px solid #bfdbfe;
  background: #eff6ff; color: #1e3a5f; }
.callout h3 { margin: 0 0 6px; font-size: 14px; }
.callout a { color: #1d4ed8; font-weight: 600; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px;
  word-break: break-all; background: rgba(120,120,120,.1); padding: 2px 6px; border-radius: 6px; }
.hash-link { text-decoration: none; }
.hash-link:hover .mono { color: var(--accent-ink); }
.spread-warn { color: var(--bad); font-weight: 600; }
@media (prefers-color-scheme: dark) { .callout { background:#0f1b2e; color:#bfdbfe; border-color:#1e3a5f; }
  .callout a { color:#93c5fd; } .quick.danger { background:#2a0f0f; border-color:#3a1a1a; color:#fca5a5; } }
`;

export function page(title: string, body: SafeHtml): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
<header class="app">
  <div class="mark" aria-hidden="true"></div>
  <div>
    <h1>User Activity Report</h1>
    <div class="sub">Cloudflare One · homegrown cross-dataset report</div>
  </div>
</header>
${body.value}
<footer class="app">
  <b>User Activity Report for Cloudflare One</b> — per-user Gateway, Access &amp; WAF activity
  correlated by identity, with category &amp; threat search. Runs free on Cloudflare Workers, no Logpush.<br>
  Clone &amp; deploy your own: <a href="https://github.com/aaron-mcallister/cf-user-activity-report">github.com/aaron-mcallister/cf-user-activity-report</a>
</footer>
</div>
</body>
</html>`;
}

/** Render an allowed/blocked/bypass/other stacked bar. */
export function actionBar(r: { allowed: number; blocked: number; bypass: number; other: number }): SafeHtml {
  const total = Math.max(1, r.allowed + r.blocked + r.bypass + r.other);
  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
  return raw(
    `<div class="bar" title="allowed ${r.allowed} · blocked ${r.blocked} · bypass ${r.bypass} · other ${r.other}">` +
      `<span class="seg-allowed" style="width:${pct(r.allowed)}"></span>` +
      `<span class="seg-blocked" style="width:${pct(r.blocked)}"></span>` +
      `<span class="seg-bypass" style="width:${pct(r.bypass)}"></span>` +
      `<span class="seg-other" style="width:${pct(r.other)}"></span>` +
      `</div>`,
  );
}

export const numberFmt = (n: number): string => n.toLocaleString("en-US");

/** Human-readable bytes, e.g. 4.2 GB. */
export function formatBytes(n: number): string {
  if (!n || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const val = n / Math.pow(1024, i);
  return `${val >= 100 || i === 0 ? Math.round(val) : val.toFixed(1)} ${units[i]}`;
}
