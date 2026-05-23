import { Router, type IRouter } from "express";
import { db, decisionsTable } from "@workspace/db";
import { sql, gte, desc } from "drizzle-orm";
import { GetDashboardMetricsQueryParams, GetDecisionSeriesQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

function windowToMs(window: string): number {
  switch (window) {
    case "1h":  return 3_600_000;
    case "24h": return 86_400_000;
    case "7d":  return 7 * 86_400_000;
    case "30d": return 30 * 86_400_000;
    default:    return 86_400_000;
  }
}

router.get("/metrics/dashboard", async (req, res) => {
  const parsed = GetDashboardMetricsQueryParams.safeParse(req.query);
  const window = parsed.success ? (parsed.data.window ?? "24h") : "24h";
  const since = new Date(Date.now() - windowToMs(window));

  try {
    const rows = await db
      .select()
      .from(decisionsTable)
      .where(gte(decisionsTable.evaluatedAt, since));

    const total = rows.length;
    const allowCount = rows.filter((r) => r.outcome === "allow").length;
    const stepUpCount = rows.filter((r) => r.outcome === "step-up").length;
    const restrictCount = rows.filter((r) => r.outcome === "restrict").length;
    const denyCount = rows.filter((r) => r.outcome === "deny").length;
    const avgLatencyMs =
      total > 0
        ? Math.round(rows.reduce((sum, r) => sum + r.latencyMs, 0) / total)
        : 0;

    const platformCounts: Record<string, number> = {};
    for (const row of rows) {
      const signals = row.signals as Array<{ platform: string }>;
      for (const s of signals) {
        if (s.platform) {
          platformCounts[s.platform] = (platformCounts[s.platform] ?? 0) + 1;
        }
      }
    }
    const topPlatforms = Object.entries(platformCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([platform, count]) => ({ platform, count }));

    res.json({
      window,
      totalDecisions: total,
      allowCount,
      stepUpCount,
      restrictCount,
      denyCount,
      allowRate: total > 0 ? allowCount / total : 0,
      restrictDenyRate: total > 0 ? (restrictCount + denyCount) / total : 0,
      avgLatencyMs,
      activeIntegrations: 9,
      totalIntegrations: 13,
      topPlatforms,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get dashboard metrics");
    res.status(500).json({ error: "internal", message: "Failed to get metrics" });
  }
});

router.get("/metrics/decisions/series", async (req, res) => {
  const parsed = GetDecisionSeriesQueryParams.safeParse(req.query);
  const window = parsed.success ? (parsed.data.window ?? "24h") : "24h";
  const granularity = parsed.success ? (parsed.data.granularity ?? "hour") : "hour";
  const since = new Date(Date.now() - windowToMs(window));

  try {
    const rows = await db
      .select()
      .from(decisionsTable)
      .where(gte(decisionsTable.evaluatedAt, since))
      .orderBy(decisionsTable.evaluatedAt);

    const buckets = new Map<string, { allow: number; stepUp: number; restrict: number; deny: number }>();

    const floor = (d: Date): string => {
      if (granularity === "minute") {
        d.setSeconds(0, 0);
      } else if (granularity === "hour") {
        d.setMinutes(0, 0, 0);
      } else {
        d.setHours(0, 0, 0, 0);
      }
      return d.toISOString();
    };

    for (const row of rows) {
      const key = floor(new Date(row.evaluatedAt));
      const bucket = buckets.get(key) ?? { allow: 0, stepUp: 0, restrict: 0, deny: 0 };
      if (row.outcome === "allow") bucket.allow++;
      else if (row.outcome === "step-up") bucket.stepUp++;
      else if (row.outcome === "restrict") bucket.restrict++;
      else if (row.outcome === "deny") bucket.deny++;
      buckets.set(key, bucket);
    }

    const series = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([timestamp, counts]) => ({ timestamp, ...counts }));

    res.json({ series });
  } catch (err) {
    req.log.error({ err }, "Failed to get decision series");
    res.status(500).json({ error: "internal", message: "Failed to get series" });
  }
});

export default router;
