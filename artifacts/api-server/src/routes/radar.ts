import { Router, type IRouter } from "express";
import { scanSignals, signalCatalog, type IncomingSignal } from "@workspace/signal-radar";

/**
 * Signal Radar surface (`/api/signals/catalog`, `/api/signals/radar`).
 *
 * Watches the edges of the grid: given a batch of incoming signals, classifies
 * each as evaluated / candidate / novel and raises first-seen alerts for signal
 * types the decision core does not yet use — a monitoring + discovery layer for
 * bringing new signals into the grid. Deterministic and public-safe.
 */
const router: IRouter = Router();

router.get("/signals/catalog", (_req, res) => {
  res.json({ demo: true, ...signalCatalog() });
});

/**
 * Scan a batch of signals. Body: { signals: [{ category, sourceReference?, observedAt? }] }
 */
router.post("/signals/radar", (req, res) => {
  const raw = Array.isArray(req.body?.signals) ? req.body.signals : [];
  const signals: IncomingSignal[] = raw
    .filter((s: unknown): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s: Record<string, unknown>) => ({
      category: typeof s.category === "string" ? s.category : "",
      sourceReference: typeof s.sourceReference === "string" ? s.sourceReference : undefined,
      observedAt: typeof s.observedAt === "string" ? s.observedAt : undefined,
    }));
  res.json({ demo: true, ...scanSignals(signals) });
});

export default router;
