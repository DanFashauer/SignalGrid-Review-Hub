import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { db, signalEventsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { IngestSignalBody, ListLatestSignalsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/signals/ingest", async (req, res) => {
  const parsed = IngestSignalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", message: "Invalid signal body" });
    return;
  }

  const { signalType, platform, deviceId, value, sourceTimestamp } = parsed.data;

  const v = value as Record<string, unknown>;
  const anomalous =
    v?.complianceStatus === "NonCompliant" ||
    v?.encrypted === false ||
    v?.kioskModeActive === false ||
    (typeof v?.openIncidents === "number" && v.openIncidents > 0);
  const critical =
    v?.jailbroken === true ||
    v?.threatRisk === "Critical";

  const signalEvent = {
    id: randomUUID(),
    signalType,
    platform,
    deviceId,
    value,
    status: critical ? "critical" : anomalous ? "anomalous" : "nominal",
    receivedAt: sourceTimestamp ? new Date(sourceTimestamp) : new Date(),
  };

  try {
    await db.insert(signalEventsTable).values(signalEvent);
    res.status(202).json({ signalId: signalEvent.id, accepted: true });
  } catch (err) {
    req.log.error({ err }, "Failed to ingest signal");
    res.status(500).json({ error: "internal", message: "Failed to ingest signal" });
  }
});

router.get("/signals/latest", async (req, res) => {
  const parsed = ListLatestSignalsQueryParams.safeParse(req.query);
  const { signalType, limit = 20 } = parsed.success
    ? parsed.data
    : { signalType: undefined, limit: 20 };

  // Clamp the client-supplied limit to a sane bound so a crafted value
  // (e.g. ?limit=1e8 or a negative/float) cannot trigger a full-table dump or
  // an invalid SQL LIMIT.
  const safeLimit = Math.min(Math.max(1, Math.floor(Number(limit) || 20)), 200);
  // Filter by signalType in SQL BEFORE limiting; filtering after LIMIT would
  // drop matching rows just past the window and return fewer than exist.
  const where = signalType ? eq(signalEventsTable.signalType, signalType) : undefined;

  try {
    const signals = await db
      .select()
      .from(signalEventsTable)
      .where(where)
      .orderBy(desc(signalEventsTable.receivedAt))
      .limit(safeLimit);

    res.json({ signals });
  } catch (err) {
    req.log.error({ err }, "Failed to list signals");
    res.status(500).json({ error: "internal", message: "Failed to list signals" });
  }
});

export default router;
