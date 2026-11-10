// Security regression tests: auth guard, security headers, CSV injection.
// Run with `npm test` (node:test via tsx). No network access is used.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import worker from "../src/index";
import { PRINT_SCRIPT, PRINT_SCRIPT_CSP_HASH } from "../src/ui/layout";
import { csvCell } from "../src/report/export";
import type { Env } from "../src/cloudflare/types";

const TEAM = "https://example-team.cloudflareaccess.com";
const AUD = "test-aud-tag";
const LIVE: Env = { CF_API_TOKEN: "dummy-token", DEMO_MODE: "off" };
const ACCESS: Env = { ...LIVE, CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD };

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256" };

function makeJwt(over: Record<string, unknown> = {}, key = privateKey): string {
  const header = b64u(JSON.stringify({ alg: "RS256", kid: "k1" }));
  const payload = b64u(
    JSON.stringify({
      iss: TEAM,
      aud: [AUD],
      exp: Math.floor(Date.now() / 1000) + 600,
      email: "a@example.com",
      ...over,
    }),
  );
  const sig = sign("sha256", Buffer.from(`${header}.${payload}`), key);
  return `${header}.${payload}.${b64u(sig)}`;
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  // Only the JWKS endpoint is reachable; any other outbound call fails, so a request that
  // passes the guard ends in a 5xx error page (never a real API call).
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const u = String(input instanceof Request ? input.url : input);
    if (u.endsWith("/cdn-cgi/access/certs")) return Response.json({ keys: [jwk] });
    throw new Error("network disabled in tests");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const get = (url: string, env: Env, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(url, { headers }), env);

test("forged Access header is rejected when Access verification is not configured", async () => {
  const res = await get("https://app.example.com/", LIVE, { "cf-access-jwt-assertion": "forged" });
  assert.equal(res.status, 403);
});

test("forged Access header is rejected when verification IS configured", async () => {
  const res = await get("https://app.example.com/", ACCESS, { "cf-access-jwt-assertion": "a.b.c" });
  assert.equal(res.status, 403);
});

test("no credentials -> 403 in live mode", async () => {
  assert.equal((await get("https://app.example.com/", LIVE)).status, 403);
  assert.equal((await get("https://app.example.com/", ACCESS)).status, 403);
});

test("valid Access JWT is accepted", async () => {
  const res = await get("https://app.example.com/", ACCESS, { "cf-access-jwt-assertion": makeJwt() });
  assert.notEqual(res.status, 403);
  assert.notEqual(res.status, 401);
});

test("JWT with wrong audience, wrong issuer, expiry, missing exp, or bad signature is rejected", async () => {
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const bad = [
    makeJwt({ aud: ["other-aud"] }),
    makeJwt({ iss: "https://evil.cloudflareaccess.com" }),
    makeJwt({ exp: Math.floor(Date.now() / 1000) - 10 }),
    makeJwt({ exp: undefined }),
    makeJwt({}, other),
  ];
  for (const t of bad) {
    const res = await get("https://app.example.com/", ACCESS, { "cf-access-jwt-assertion": t });
    assert.equal(res.status, 403);
  }
});

test("ALLOW_UNAUTHENTICATED works on localhost only", async () => {
  const env = { ...LIVE, ALLOW_UNAUTHENTICATED: "true" };
  assert.notEqual((await get("http://localhost:8787/", env)).status, 403);
  assert.notEqual((await get("http://127.0.0.1:8787/", env)).status, 403);
  assert.equal((await get("https://app.example.com/", env)).status, 403);
  assert.equal((await get("https://my-worker.me.workers.dev/", env)).status, 403);
});

test("Basic Auth: correct, wrong, missing", async () => {
  const env = { ...LIVE, BASIC_AUTH_USER: "u", BASIC_AUTH_PASS: "p" };
  const ok = "Basic " + Buffer.from("u:p").toString("base64");
  const wrong = "Basic " + Buffer.from("u:x").toString("base64");
  assert.notEqual((await get("https://app.example.com/", env, { authorization: ok })).status, 401);
  assert.equal((await get("https://app.example.com/", env, { authorization: wrong })).status, 401);
  assert.equal((await get("https://app.example.com/", env)).status, 401);
});

test("Basic Auth is enforced even if a forged Access header is sent", async () => {
  const env = { ...ACCESS, BASIC_AUTH_USER: "u", BASIC_AUTH_PASS: "p" };
  const res = await get("https://app.example.com/", env, { "cf-access-jwt-assertion": makeJwt() });
  assert.equal(res.status, 401);
});

test("demo page serves strict security headers and no inline handlers", async () => {
  const res = await get("https://app.example.com/", { DEMO_MODE: "on" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  const csp = res.headers.get("content-security-policy") || "";
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  const body = await res.text();
  assert.ok(body.includes("data-print"));
  assert.ok(!/onclick=/i.test(body), "inline onclick would be blocked by CSP");
});

test("CSP script hash matches the inline print script", () => {
  const h = "sha256-" + createHash("sha256").update(PRINT_SCRIPT).digest("base64");
  assert.equal(PRINT_SCRIPT_CSP_HASH, h);
});

test("error and deny pages also carry security headers", async () => {
  const res = await get("https://app.example.com/", LIVE);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.ok(res.headers.get("content-security-policy"));
});

test("csvCell neutralizes formula injection and quotes specials", () => {
  assert.equal(csvCell("=HYPERLINK(\"http://x\")"), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell("-2"), "'-2");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell(-5), "-5"); // real numbers are untouched
  assert.equal(csvCell(null), "");
});
