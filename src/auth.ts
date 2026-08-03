// Cloudflare Access verification (zero-dependency, WebCrypto).
//
// When Cloudflare Access protects a route, it injects a signed JWT in the
// `Cf-Access-Jwt-Assertion` request header. This module verifies that JWT
// (RS256 signature against the team's JWKS, plus issuer / audience / expiry)
// so the app can trust that the caller was authenticated by Access.
//
// Docs: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/

export interface AccessVerifyResult {
  valid: boolean;
  email?: string;
  reason?: string;
}

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

const JWKS_TTL_MS = 60 * 60 * 1000; // cache keys for 1 hour
const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();

function b64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const b64urlToString = (s: string): string => new TextDecoder().decode(b64urlToBytes(s));

const trimSlash = (s: string): string => s.replace(/\/+$/, "");

async function getKeys(teamDomain: string): Promise<Jwk[]> {
  const cached = jwksCache.get(teamDomain);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const res = await fetch(`${trimSlash(teamDomain)}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`JWKS fetch failed (HTTP ${res.status})`);
  const data = (await res.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(data.keys) ? data.keys : [];
  jwksCache.set(teamDomain, { keys, fetchedAt: Date.now() });
  return keys;
}

/**
 * Verify a Cloudflare Access application JWT. Returns {valid:true, email} when the
 * signature, issuer, audience, and expiry all check out; otherwise {valid:false, reason}.
 */
export async function verifyAccessJwt(
  token: string,
  teamDomain: string,
  aud: string,
): Promise<AccessVerifyResult> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return { valid: false, reason: "malformed token" };

    const header = JSON.parse(b64urlToString(parts[0])) as { alg?: string; kid?: string };
    if (header.alg !== "RS256") return { valid: false, reason: `unsupported alg ${header.alg}` };

    const payload = JSON.parse(b64urlToString(parts[1])) as {
      aud?: string | string[];
      iss?: string;
      exp?: number;
      email?: string;
    };

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && now >= payload.exp) return { valid: false, reason: "token expired" };
    if (trimSlash(payload.iss || "") !== trimSlash(teamDomain)) {
      return { valid: false, reason: "issuer mismatch" };
    }
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(aud)) return { valid: false, reason: "audience mismatch" };

    const keys = await getKeys(teamDomain);
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return { valid: false, reason: "signing key not found" };

    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const sig = b64urlToBytes(parts[2]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
    if (!ok) return { valid: false, reason: "signature verification failed" };

    return { valid: true, email: payload.email };
  } catch (e) {
    return { valid: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Header Cloudflare Access sets with the signed application token. */
export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
/** Convenience identity header Access also sets. */
export const ACCESS_EMAIL_HEADER = "cf-access-authenticated-user-email";
