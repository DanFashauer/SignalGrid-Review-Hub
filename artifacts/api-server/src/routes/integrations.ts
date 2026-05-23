import { Router, type IRouter } from "express";
import { GetIntegrationParams } from "@workspace/api-zod";

const router: IRouter = Router();

const INTEGRATIONS = [
  {
    id: "fleet",
    vendor: "Fleet",
    product: "Fleet MDM",
    category: "MDM / UEM",
    signalTypes: ["device-posture"],
    status: "connected",
    lastSync: new Date(Date.now() - 45_000).toISOString(),
    signalsIngested24h: 1842,
    latencyMs: 312,
  },
  {
    id: "intune-entra",
    vendor: "Microsoft",
    product: "Intune + Entra ID",
    category: "MDM / UEM + Identity",
    signalTypes: ["device-posture", "identity"],
    status: "connected",
    lastSync: new Date(Date.now() - 12_000).toISOString(),
    signalsIngested24h: 4203,
    latencyMs: 187,
  },
  {
    id: "servicenow",
    vendor: "ServiceNow",
    product: "ServiceNow ITSM",
    category: "ITSM",
    signalTypes: ["operational-signals"],
    status: "connected",
    lastSync: new Date(Date.now() - 90_000).toISOString(),
    signalsIngested24h: 284,
    latencyMs: 423,
  },
  {
    id: "workspace-one",
    vendor: "Omnissa (VMware)",
    product: "Workspace ONE UEM",
    category: "MDM / UEM",
    signalTypes: ["device-posture", "session-context"],
    status: "connected",
    lastSync: new Date(Date.now() - 30_000).toISOString(),
    signalsIngested24h: 2187,
    latencyMs: 265,
  },
  {
    id: "jamf",
    vendor: "Jamf",
    product: "Jamf Pro",
    category: "MDM / UEM",
    signalTypes: ["device-posture"],
    status: "degraded",
    lastSync: new Date(Date.now() - 600_000).toISOString(),
    signalsIngested24h: 341,
    latencyMs: 1840,
    errorMessage: "API rate limit approaching — throttling signal ingestion",
  },
  {
    id: "okta",
    vendor: "Okta",
    product: "Okta Workforce Identity",
    category: "Identity",
    signalTypes: ["identity"],
    status: "connected",
    lastSync: new Date(Date.now() - 8_000).toISOString(),
    signalsIngested24h: 5621,
    latencyMs: 95,
  },
  {
    id: "hexnode",
    vendor: "Mitsogo (Hexnode)",
    product: "Hexnode UEM",
    category: "MDM / UEM",
    signalTypes: ["device-posture", "session-context"],
    status: "connected",
    lastSync: new Date(Date.now() - 60_000).toISOString(),
    signalsIngested24h: 892,
    latencyMs: 341,
  },
  {
    id: "maas360",
    vendor: "IBM",
    product: "IBM Security MaaS360",
    category: "MDM / UEM",
    signalTypes: ["device-posture", "identity"],
    status: "connected",
    lastSync: new Date(Date.now() - 120_000).toISOString(),
    signalsIngested24h: 1234,
    latencyMs: 502,
  },
  {
    id: "ninjarmm",
    vendor: "NinjaOne",
    product: "NinjaOne RMM",
    category: "MDM / UEM",
    signalTypes: ["device-posture"],
    status: "not-configured",
    lastSync: null,
    signalsIngested24h: 0,
    latencyMs: 0,
  },
  {
    id: "ivanti",
    vendor: "Ivanti",
    product: "Ivanti Neurons for UEM",
    category: "MDM / UEM",
    signalTypes: ["device-posture"],
    status: "not-configured",
    lastSync: null,
    signalsIngested24h: 0,
    latencyMs: 0,
  },
  {
    id: "manage-engine",
    vendor: "ManageEngine",
    product: "ManageEngine Endpoint Central",
    category: "MDM / UEM",
    signalTypes: ["device-posture"],
    status: "not-configured",
    lastSync: null,
    signalsIngested24h: 0,
    latencyMs: 0,
  },
  {
    id: "tanium",
    vendor: "Tanium",
    product: "Tanium Autonomous IT Platform",
    category: "MDM / UEM",
    signalTypes: ["device-posture", "operational-signals"],
    status: "connected",
    lastSync: new Date(Date.now() - 20_000).toISOString(),
    signalsIngested24h: 672,
    latencyMs: 6100,
  },
  {
    id: "jira",
    vendor: "Atlassian",
    product: "Jira Service Management",
    category: "ITSM",
    signalTypes: ["operational-signals"],
    status: "connected",
    lastSync: new Date(Date.now() - 180_000).toISOString(),
    signalsIngested24h: 121,
    latencyMs: 387,
  },
];

router.get("/integrations", (_req, res) => {
  res.json({ integrations: INTEGRATIONS });
});

router.get("/integrations/:id", (req, res) => {
  const parsed = GetIntegrationParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", message: "Invalid integration ID" });
    return;
  }

  const integration = INTEGRATIONS.find((i) => i.id === parsed.data.id);
  if (!integration) {
    res.status(404).json({ error: "not_found", message: "Integration not found" });
    return;
  }

  res.json(integration);
});

export default router;
