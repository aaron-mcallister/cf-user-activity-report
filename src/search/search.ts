import type { Report } from "../cloudflare/types";

/**
 * Categories where Cloudflare's recommended HTTP policies suggest **isolation**
 * (Remote Browser Isolation) rather than a hard block — the tee-up for the RBI story.
 * See: https://developers.cloudflare.com/learning-paths/secure-internet-traffic/build-http-policies/recommended-http-policies/#all-http-domain-isolate
 */
export const ISOLATION_RECOMMENDED = new Set([
  "newly seen domains",
  "new domains",
  "anonymizer",
  "cryptomining",
]);

export const RBI_LEARNING_PATH =
  "https://developers.cloudflare.com/learning-paths/secure-internet-traffic/build-http-policies/recommended-http-policies/#all-http-domain-isolate";

export interface CategorySearchResult {
  kind: "category";
  query: string;
  category: string;
  isolationRecommended: boolean;
  totalHits: number;
  blocked: number;
  users: { email: string; count: number; blocked: number }[];
}

export interface HashSearchResult {
  kind: "hash";
  query: string;
  fileHash: string;
  fileName?: string;
  holders: {
    email: string;
    deviceIds: string[];
    action: string;
    host: string;
    when?: string;
    sizeBytes: number;
  }[];
}

export interface HostSearchResult {
  kind: "host";
  query: string;
  host: string;
  users: { email: string; count: number }[];
}

export interface TextSearchResult {
  kind: "text";
  query: string;
  users: string[];
  categories: string[];
  hosts: string[];
}

export interface EmptySearchResult {
  kind: "empty";
  query: string;
}

export type SearchResult =
  | CategorySearchResult
  | HashSearchResult
  | HostSearchResult
  | TextSearchResult
  | EmptySearchResult;

const isHashLike = (q: string) => /^[a-f0-9]{16,}$/i.test(q.trim());
const looksLikeHost = (q: string) => /\./.test(q) && !/\s/.test(q);

/** All distinct category names present in the report. */
function allCategories(report: Report): string[] {
  const set = new Set<string>();
  for (const u of report.users) for (const c of u.categories) set.add(c.category);
  return [...set];
}

function searchCategory(report: Report, query: string, category: string): CategorySearchResult {
  const users: { email: string; count: number; blocked: number }[] = [];
  let totalHits = 0;
  let blocked = 0;
  for (const u of report.users) {
    const hit = u.categories.find((c) => c.category.toLowerCase() === category.toLowerCase());
    if (hit) {
      users.push({ email: u.email, count: hit.count, blocked: hit.blocked });
      totalHits += hit.count;
      blocked += hit.blocked;
    }
  }
  users.sort((a, b) => b.count - a.count);
  return {
    kind: "category",
    query,
    category,
    isolationRecommended: ISOLATION_RECOMMENDED.has(category.toLowerCase()),
    totalHits,
    blocked,
    users,
  };
}

function searchHash(report: Report, query: string): HashSearchResult {
  const q = query.trim().toLowerCase();
  const holders: HashSearchResult["holders"] = [];
  let fileHash = query.trim();
  let fileName: string | undefined;
  for (const u of report.users) {
    for (const f of u.files) {
      const h = f.fileHash.toLowerCase();
      if (h === q || h.startsWith(q)) {
        fileHash = f.fileHash;
        fileName = f.fileName;
        holders.push({
          email: u.email,
          deviceIds: u.deviceIds,
          action: f.action,
          host: f.host,
          when: f.when,
          sizeBytes: f.sizeBytes,
        });
      }
    }
  }
  return { kind: "hash", query, fileHash, fileName, holders };
}

function searchHost(report: Report, query: string, host: string): HostSearchResult {
  const q = host.toLowerCase();
  const users: { email: string; count: number }[] = [];
  for (const u of report.users) {
    const matches = u.topHosts.filter((h) => h.host.toLowerCase().includes(q));
    if (matches.length) {
      users.push({ email: u.email, count: matches.reduce((n, h) => n + h.count, 0) });
    }
  }
  users.sort((a, b) => b.count - a.count);
  return { kind: "host", query, host, users };
}

function searchText(report: Report, query: string): TextSearchResult {
  const q = query.toLowerCase();
  const users = new Set<string>();
  const categories = new Set<string>();
  const hosts = new Set<string>();
  for (const u of report.users) {
    if (u.email.toLowerCase().includes(q)) users.add(u.email);
    for (const c of u.categories) if (c.category.toLowerCase().includes(q)) categories.add(c.category);
    for (const h of u.topHosts) if (h.host.toLowerCase().includes(q)) hosts.add(h.host);
  }
  return {
    kind: "text",
    query,
    users: [...users],
    categories: [...categories],
    hosts: [...hosts],
  };
}

/**
 * Top-level search across the report: routes a query to a hash / category / host /
 * free-text pivot. This is the "search for X, see who/what/how-much" entry point.
 */
export function searchReport(report: Report, rawQuery: string): SearchResult {
  const query = (rawQuery || "").trim();
  if (!query) return { kind: "empty", query };

  // 1. File hash pivot (lateral-movement view).
  if (isHashLike(query)) {
    const res = searchHash(report, query);
    if (res.holders.length) return res;
  }

  // 2. Category pivot (exact, then substring).
  const cats = allCategories(report);
  const exact = cats.find((c) => c.toLowerCase() === query.toLowerCase());
  const partial = exact || cats.find((c) => c.toLowerCase().includes(query.toLowerCase()));
  if (partial) return searchCategory(report, query, partial);

  // 3. Host / domain pivot.
  if (looksLikeHost(query)) {
    const res = searchHost(report, query, query);
    if (res.users.length) return res;
  }

  // 4. Free-text fallback across users / categories / hosts.
  const text = searchText(report, query);
  if (text.users.length || text.categories.length || text.hosts.length) return text;

  return { kind: "empty", query };
}
