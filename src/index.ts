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
import { verifyAccessJwt, ACCESS_JWT_HEADER } from "./auth";
import { escapeHtml, html, page, PRINT_SCRIPT_CSP_HASH } from "./ui/layout";

const HTML = { "content-type": "text/html; charset=utf-8" };
const JSON_H = { "content-type": "application/json; charset=utf-8" };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Constant-time comparison. Both sides are hashed first so length can't leak either. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// Strict CSP: no external resources, no inline script except the hash-pinned print helper.
const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  `script-src '${PRINT_SCRIPT_CSP_HASH}'`,
  "img-src 'self' data:",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** These pages contain PII: never cache, never index, never frame, never leak via Referer. */
function withSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  if ((headers.get("content-type") || "").startsWith("text/html")) {
    headers.set("Content-Security-Policy", CSP);
    headers.set("X-Frame-Options", "DENY");
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function denyPage(title: string, body: ReturnType<typeof html>, status: number): Response {
  return new Response(page(title, body), { status, headers: HTML });
}

/**
 * Returns a Response if the request should be blocked, or null if allowed.
 *
 * Live data is PII, so this fails closed. A request is allowed only if:
 *   1. Basic Auth is configured and the credentials match, or
 *   2. the app is in demo mode (synthetic data only), or
 *   3. a Cloudflare Access JWT is present AND verifies (signature, issuer, audience,
 *      expiry) against CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD, or
 *   4. ALLOW_UNAUTHENTICATED=true AND the request hostname is loopback (local dev only).
 *
 * The mere presence of an Access header is never trusted: any client can send one.
 */
async function guard(cfg: ResolvedConfig, request: Request, url: URL): Promise<Response | null> {
  // If Basic Auth is configured, always enforce it.
  if (cfg.basicAuth) {
    const hdr = request.headers.get("Authorization") || "";
    const expected = "Basic " + btoa(`${cfg.basicAuth.user}:${cfg.basicAuth.pass}`);
    if (!(await safeEqual(hdr, expected))) {
      return new Response("Authentication required", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="User Activity Report"' },
      });
    }
    return null;
  }

  // Synthetic demo data is safe to serve openly.
  if (cfg.demo) return null;

  // --- Cloudflare Access, with cryptographic verification of the signed token ---
  if (cfg.access.aud && cfg.access.teamDomain) {
    const accessJwt = request.headers.get(ACCESS_JWT_HEADER);
    if (!accessJwt) {
      return denyPage("Access required", accessRequiredNotice(), 403);
    }
    const result = await verifyAccessJwt(accessJwt, cfg.access.teamDomain, cfg.access.aud);
    if (!result.valid) {
      return denyPage(
        "Access denied",
        html`<div class="notes"><b>Access token could not be verified.</b> ${result.reason || "invalid token"}.</div>
          <div class="panel"><div class="body" style="padding:16px"><p class="muted">
          Check that <code>CF_ACCESS_AUD</code> matches your Access application's AUD tag and that
          <code>CF_ACCESS_TEAM_DOMAIN</code> is your team domain.</p></div></div>`,
        403,
      );
    }
    return null; // verified Access identity
  }

  // Local development only: explicit opt-in, honored solely on a loopback hostname.
  if (cfg.allowUnauthenticated && LOOPBACK_HOSTS.has(url.hostname)) return null;

  // Live data (PII) with no verified auth -> refuse with guidance.
  return denyPage("Setup required", setupNotice(), 403);
}

function accessRequiredNotice() {
  return html`
    <div class="notes"><b>This app is protected by Cloudflare Access.</b> No valid Access
      session was found on this request.</div>
    <div class="panel"><div class="body" style="padding:16px">
      <p>If you're seeing this, you likely reached the app through a route that isn't behind
        Access. Open it via the <b>Access-protected hostname</b> (the one where you log in), or
        remove any unprotected route (see <code>docs/deploy.md</code>).</p>
    </div></div>`;
}

function setupNotice() {
  return html`
    <div class="notes">
      <b>Live data is protected.</b> This is not an error — the app won't show real user
      activity (PII) until authentication is configured.
    </div>
    <div class="callout">
      <h3>👩‍💻 Testing on your own computer?</h3>
      <div>Run <code>npm run setup</code> (it enables local viewing for you), or add this line to
        your <code>.dev.vars</code> file and restart. It is honored on <b>localhost only</b>:<br>
        <code>ALLOW_UNAUTHENTICATED="true"</code></div>
    </div>
    <div class="panel"><div class="body" style="padding:16px">
      <p>Before exposing live data on a <b>deployed</b> site, configure authentication — choose one:</p>
      <ul>
        <li><b>Recommended:</b> put <b>Cloudflare Access</b> in front of this Worker
          (Zero Trust → Access → Applications) <i>and</i> set <code>CF_ACCESS_TEAM_DOMAIN</code>
          and <code>CF_ACCESS_AUD</code> so the app verifies the signed Access token. An Access
          header on its own is not trusted. See <code>docs/deploy.md</code>.</li>
        <li>Or set built-in Basic Auth secrets:
          <code>npx wrangler secret put BASIC_AUTH_USER</code> and
          <code>npx wrangler secret put BASIC_AUTH_PASS</code>.</li>
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

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cfg = resolveConfig(env);

    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });
    if (url.pathname === "/healthz") return new Response("ok", { status: 200 });

    const blocked = await guard(cfg, request, url);
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

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Optional retention: snapshot to R2 (no-op unless ACTIVITY_BUCKET is bound).
    ctx.waitUntil(
      snapshotToR2(env).then((r) => console.log("snapshot:", JSON.stringify(r))),
    );
  },
};

export default {
  fetch: async (request: Request, env: Env): Promise<Response> =>
    withSecurityHeaders(await worker.fetch(request, env)),
  scheduled: worker.scheduled,
} satisfies ExportedHandler<Env>;
