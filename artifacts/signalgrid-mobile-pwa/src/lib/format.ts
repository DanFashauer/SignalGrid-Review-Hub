import { formatDistanceToNow } from "date-fns";

/**
 * A rate that may be absent. `(metrics?.allowRate || 0) * 100` rendered
 * "0.0%" for a metrics feed that never answered — a measured figure minted from
 * nothing. Absent renders as a dash, exactly as the desktop does.
 */
export function formatRate(fraction: number | undefined): string {
  if (fraction === undefined || !Number.isFinite(fraction)) return "–";
  return `${(fraction * 100).toFixed(1)}%`;
}

export function formatTimeAgo(dateString: string | undefined): string {
  if (!dateString) return "unknown";
  try {
    return formatDistanceToNow(new Date(dateString), { addSuffix: true })
      .replace("about ", "")
      .replace("less than a minute ago", "just now");
  } catch (e) {
    return "unknown";
  }
}

export function formatLatency(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "–";
  return `${ms.toFixed(0)}ms`;
}

export function formatNumber(n: number | undefined): string {
  // An absent count is not zero. "Total Decisions 0" for a feed that never
  // answered was byte-identical to a real zero; the dash is what the desktop
  // renders for the same state, and it is the honest one.
  if (n === undefined || !Number.isFinite(n)) return "–";
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}
