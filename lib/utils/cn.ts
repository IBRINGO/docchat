/** Joins conditional class names, skipping falsy values. A tiny local stand-in for `clsx` — not worth a dependency for this. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
