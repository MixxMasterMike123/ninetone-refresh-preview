/**
 * FileMaker's booking portals include former talents as well as the roster
 * that can currently be sold. Keep this deliberately strict: a missing,
 * malformed, or unknown value must never become publicly bookable.
 */
export function isActiveBookingArtist(row: Record<string, unknown>): boolean {
  // A row should carry one of these fields. If it somehow carries both, they
  // must agree: a contradictory CMS response fails closed rather than making
  // a former talent bookable.
  const statuses = [row.filterActive, row["Green HeadArtist::filterActive"]].filter(
    (value) => value !== undefined,
  );
  return statuses.length > 0 && statuses.every((value) => value === "Active");
}
