// Shared span→grid-column mapping so the live dashboard and the public shared
// view can't drift. Spans are stored on a 12-column scale; the shared view
// renders on a 3-column grid. Anything unpinned (0) or narrow falls back to a
// single column.
export function spanToCols(span: number | undefined): number {
  const s = span ?? 0;
  if (s >= 12) return 3;
  if (s >= 6) return 2;
  return 1;
}
