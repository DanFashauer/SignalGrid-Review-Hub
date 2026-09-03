import { format, formatDistanceToNow, isValid } from "date-fns";

export function formatDate(dateStr: string | undefined | null) {
  if (!dateStr) return "N/A";
  // A non-empty but unparseable timestamp yields an Invalid Date; date-fns's
  // format()/formatDistanceToNow() throw RangeError on one. Guard with isValid so
  // a bad value reads as unverified/unparseable, never crashes the render.
  const d = new Date(dateStr);
  if (!isValid(d)) return "unparseable timestamp";
  return format(d, "MMM d, yyyy HH:mm:ss");
}

export function formatTimeAgo(dateStr: string | undefined | null) {
  if (!dateStr) return "N/A";
  const d = new Date(dateStr);
  if (!isValid(d)) return "unparseable timestamp";
  return formatDistanceToNow(d, { addSuffix: true });
}
