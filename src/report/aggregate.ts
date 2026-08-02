// Small pure helpers used by the identity join.

export type ActionClass = "allowed" | "blocked" | "bypass" | "other";

/** Map a Gateway action string into one of our four buckets. */
export function classifyAction(action?: string): ActionClass {
  switch ((action || "").toLowerCase()) {
    case "allow":
    case "allowed":
      return "allowed";
    case "block":
    case "blocked":
      return "blocked";
    case "bypass":
      return "bypass";
    default:
      return "other";
  }
}

/** Normalise an email for use as a map key. Empty -> "(unattributed)". */
export function normEmail(email?: string): string {
  const e = (email || "").trim().toLowerCase();
  return e || "(unattributed)";
}

/** Top-N entries of a label->count map, sorted descending. */
export function topN<T extends string>(
  counts: Map<T, number>,
  n: number,
): { label: T; count: number }[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

/** Increment a counter inside a Map. */
export function bump<T>(map: Map<T, number>, key: T, by = 1): void {
  map.set(key, (map.get(key) || 0) + by);
}
