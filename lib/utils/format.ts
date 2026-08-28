/** Formats a byte count as a human-readable MB value (e.g. 2456789 → "2.4 MB"). Assessment-scale documents are always well under 1 GB, so MB is the only unit needed. */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Renders a short, human-readable label for an active document set: the name itself for one or two documents, otherwise a count. Used anywhere the UI needs to say "chatting with X" without listing every name inline. */
export function formatDocumentNameList(names: readonly string[]): string {
  if (names.length === 0) return "your documents";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.length} documents`;
}

/** Formats an ISO date string as a short relative label ("Added today", "Added 3 days ago") or a plain date once it's more than a week old. */
export function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return "Added today";
  if (diffDays === 1) return "Added yesterday";
  if (diffDays < 7) return `Added ${diffDays} days ago`;
  return `Added ${date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`;
}
