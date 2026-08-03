import type { Env } from "./cloudflare/types";
import { resolveConfig, resolveWindow, type ResolvedConfig } from "./config";
import { buildReport } from "./report/build";
import { reportToCsv } from "./report/export";
import { renderDashboard } from "./ui/dashboard";
import { renderUser } from "./ui/user";
import { renderSearch } from "./ui/search";
import { searchReport } from "./search/search";
import { normEmail } from "./report/aggregate";
import { runPreflight } from "./preflight";
import { snapshotToR2 } from "./retention/snapshot";
import { escapeHtml, html, page } from "./ui/layout";

const HTML = { "content-type": "text/html; charset=utf-8" };
const JSON_H = { "content-type": "application/json; charset=utf-8" };

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Returns a Response if the request should be blocked, or null if allowed. */
function guard(cfg: ResolvedConfig, request: Request): Response | null {
  // If Basic Auth is configured, always enforce it.
  if (cfg.basicAuth) {
    const hdr = request.headers.get("Authorization") || "";
    const expected = "Basic " + btoa(`${cfg.basicAuth.user}:${cfg.basicAuth.pass}`);
    if (!timingSafeEqual(hdr, expected)) {
      return new Response("Authentication required", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="User Activity Report"' },
      });
    }
    return null;
  }
  // Synthetic demo data is safe to serve openly.
  if (cfg.demo) return null;
  // Explicit opt-in to serve live data without app-layer auth.
  if (cfg.allowUnauthenticated) return null;
  // Live data (PII) with no auth configured -> refuse with guidance.
  return new Response(page("Setup required", setupNotice()), { status: 403, headers: HTML });
}

function setupNotice() {
  return html`
    <div class="notes">
      <b>Live data is protected.</b> This deployment would serve real user activity (PII)
      but no app-layer authentication is configured.
    </div>
    <div class="panel"><div class="body" style="padding:16px">
      <p>Choose one before exposing live data:</p>
      <ul>
        <li><b>Recommended:</b> put <b>Cloudflare Access</b> in front of this Worker's route
          (Zero Trust → Access → Applications), then it's protected at the edge.</li>
        <li>Or set built-in Basic Auth secrets:
          <code>wrangler secret put BASIC_AUTH_USER</code> and
          <code>wrangler secret put BASIC_AUTH_PASS</code>.</li>
        <li>Or, only for a throwaway test, set <code>ALLOW_UNAUTHENTICATED=true</code> in
          <code>wrangler.jsonc</code> (not recommended).</li>
      </ul>
      <p class="muted">Tip: run <code>npm run dev</code> with no token to explore the UI with
        synthetic demo data instead.</p>
    </div></div>`;
}

function errorPage(message: string): string {
  return page(
    "Error",
    html`<div class="notes"><b>Something went wrong.</b></div>
      <div class="panel"><div class="body" style="padding:16px">
        <p class="muted">The report could not be built:</p>
        <pre style="white-space:pre-wrap">${escapeHtml(message)}</pre>
        <p><a href="/">← Back</a> · <a href="/preflight">Run preflight</a></p>
      </div></div>`,
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cfg = resolveConfig(env);

    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });
    if (url.pathname === "/healthz") return new Response("ok", { status: 200 });

    const blocked = guard(cfg, request);
    if (blocked) return blocked;

    try {
      if (url.pathname === "/preflight") {
        const result = await runPreflight(cfg);
        return new Response(JSON.stringify(result, null, 2), { headers: JSON_H });
      }

      const win = resolveWindow(url);

      if (url.pathname === "/" ) {
        const report = await buildReport(cfg, win);
        return new Response(renderDashboard(report), { headers: HTML });
      }

      if (url.pathname === "/search") {
        const q = url.searchParams.get("q") || "";
        const report = await buildReport(cfg, win);
        const result = searchReport(report, q);
        return new Response(renderSearch(result, report), { headers: HTML });
      }

      if (url.pathname === "/report.json") {
        const report = await buildReport(cfg, win);
        return new Response(JSON.stringify(report, null, 2), { headers: JSON_H });
      }

      if (url.pathname === "/report.csv") {
        const report = await buildReport(cfg, win);
        return new Response(reportToCsv(report), {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="user-activity-${win.days}d.csv"`,
          },
        });
      }

      if (url.pathname.startsWith("/user/")) {
        const email = decodeURIComponent(url.pathname.slice("/user/".length));
        const report = await buildReport(cfg, win);
        const target = normEmail(email);
        const user = report.users.find((u) => normEmail(u.email) === target);
        if (!user) {
          return new Response(errorPage(`No activity for user: ${email}`), { status: 404, headers: HTML });
        }
        return new Response(renderUser(user, report.meta), { headers: HTML });
      }

      return new Response(errorPage("Not found"), { status: 404, headers: HTML });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(errorPage(msg), { status: 500, headers: HTML });
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Optional retention: snapshot to R2 (no-op unless ACTIVITY_BUCKET is bound).
    ctx.waitUntil(
      snapshotToR2(env).then((r) => console.log("snapshot:", JSON.stringify(r))),
    );
  },
};
