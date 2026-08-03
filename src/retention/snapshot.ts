import type { Env } from "../cloudflare/types";
import { resolveConfig } from "../config";
import { buildReport } from "../report/build";

export interface SnapshotOutcome {
  ok: boolean;
  key?: string;
  users?: number;
  note?: string;
}

/**
 * Optional self-hosted retention (off by default).
 * Pulls the last 24h and appends a per-user NDJSON snapshot into R2 so history is
 * retained beyond the platform's short analytics window. No-op unless the
 * ACTIVITY_BUCKET binding is present (see wrangler.jsonc), so the default deploy
 * stays stateless and zero-config.
 */
export async function snapshotToR2(env: Env): Promise<SnapshotOutcome> {
  const cfg = resolveConfig(env);
  if (!env.ACTIVITY_BUCKET) {
    return { ok: false, note: "ACTIVITY_BUCKET not bound — optional retention disabled." };
  }
  if (cfg.demo) {
    return { ok: false, note: "Demo mode — nothing to snapshot." };
  }

  const end = new Date();
  const start = new Date(end.getTime() - 86_400_000);
  const report = await buildReport(cfg, { start, end, days: 1 });

  const lines = report.users.map((u) =>
    JSON.stringify({
      snapshotAt: report.meta.generatedAt,
      windowStart: report.meta.windowStart,
      windowEnd: report.meta.windowEnd,
      accountId: report.meta.accountId,
      ...u,
    }),
  );
  const body = lines.join("\n") + "\n";
  const key = `snapshots/${end.toISOString().slice(0, 10)}/${end.toISOString().replace(/[:.]/g, "-")}.ndjson`;

  await env.ACTIVITY_BUCKET.put(key, body, {
    httpMetadata: { contentType: "application/x-ndjson" },
  });

  return { ok: true, key, users: report.users.length };
}
