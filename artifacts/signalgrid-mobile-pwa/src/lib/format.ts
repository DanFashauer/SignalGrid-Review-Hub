import { formatDistanceToNow } from "date-fns";

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
  if (ms === undefined) return "-";
  return `${ms.toFixed(0)}ms`;
}

export function formatNumber(n: number | undefined): string {
  if (n === undefined) return "0";
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}
