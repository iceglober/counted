const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * `2026-07-31` → `Jul 31, 2026`.
 *
 * One copy. It was written twice — the blog index and the post layout — with
 * the same bug in both: indexing `MONTHS[m - 1]` straight from a split, so a
 * date with a typo rendered `undefined 31, 2026`. Two copies of a function is
 * two places for the same fix to be missed, and v2's stricter compiler is what
 * refused to build either.
 *
 * An unparseable date falls back to the ISO string, which is ugly and correct
 * — better than a confident wrong answer on a published page.
 */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1];
  if (y === undefined || month === undefined || d === undefined) return iso;
  return `${month} ${Number(d)}, ${y}`;
}
