// Public-safe catalog of integrated application workflows, by vertical.
//
// These are generic app CATEGORIES (never a real vendor/product name) with the
// kinds of actions people perform in them. `workflowKey` is the decision-core
// workflow the app's session maps to; the three seeded demo tenants
// (healthcare / warehouse / global-fleet) can evaluate live, while retail and
// industrial are catalog entries the same engine plans (supply a decision).
//
// Risk tiers: standard (low-risk read/ack) · elevated (writes / sensitive reads)
// · critical (irreversible / high-consequence — always sensitive). `sensitive`
// forces human confirmation even on an allow; `gatedByStepUp` marks the actions
// a step-up holds and a restriction blocks.

import type { AppIntegration } from "./index";

const a = (
  key: string,
  label: string,
  riskTier: "standard" | "elevated" | "critical",
  opts: { sensitive?: boolean; gated?: boolean } = {},
) => ({
  key,
  label,
  riskTier,
  sensitive: opts.sensitive ?? riskTier === "critical",
  gatedByStepUp: opts.gated ?? riskTier !== "standard",
});

export const APP_INTEGRATIONS: AppIntegration[] = [
  // ── Healthcare (P1) ─────────────────────────────────────────────────────────
  {
    id: "emr-chart",
    name: "EMR / chart",
    category: "Clinical record",
    vertical: "healthcare",
    workflowKey: "clinical-session",
    actions: [
      a("chart.open", "Open patient chart", "elevated"),
      a("results.view", "View lab / imaging results", "elevated"),
      a("note.document", "Document a note", "standard"),
      a("order.place", "Place / verify a medication order", "critical"),
      a("discharge.release", "Release discharge", "critical"),
    ],
  },
  {
    id: "bcma",
    name: "BCMA (barcode med admin)",
    category: "Medication administration",
    vertical: "healthcare",
    workflowKey: "med-admin",
    actions: [
      a("patient.scan", "Scan patient wristband", "standard"),
      a("med.scan", "Scan medication", "elevated"),
      a("controlled.administer", "Administer controlled substance", "critical"),
      a("dose.override", "Override a dose warning", "critical"),
      a("witness.cosign", "Second-nurse witness co-sign", "critical"),
    ],
  },
  {
    id: "secure-messaging",
    name: "Secure clinical messaging",
    category: "Clinical communication",
    vertical: "healthcare",
    workflowKey: "clinical-session",
    actions: [
      a("message.send", "Send a secure message", "standard"),
      a("message.ack", "Acknowledge a message", "standard"),
      a("physician.escalate", "Escalate to physician", "elevated"),
      a("code.broadcast", "Broadcast a code / RRT alert", "critical"),
    ],
  },
  {
    id: "alarms",
    name: "Alarms / middleware",
    category: "Physiologic alarms",
    vertical: "healthcare",
    workflowKey: "clinical-session",
    actions: [
      a("alarm.route", "Route alarms to holder", "standard", { gated: false }),
      a("alarm.ack", "Acknowledge an alarm", "elevated"),
      a("alarm.silence", "Silence a critical alarm", "critical"),
    ],
  },

  // ── Warehouse (P2) ──────────────────────────────────────────────────────────
  {
    id: "wms",
    name: "WMS / WES",
    category: "Warehouse execution",
    vertical: "warehouse",
    workflowKey: "pick-pack",
    actions: [
      a("task.accept", "Accept a pick task", "standard"),
      a("pick.confirm", "Confirm a pick", "standard"),
      a("inventory.adjust", "Adjust inventory", "elevated"),
      a("highvalue.release", "Release a high-value / hazmat pick", "critical"),
    ],
  },
  {
    id: "labor-task",
    name: "Labor / task",
    category: "Task management",
    vertical: "warehouse",
    workflowKey: "pick-pack",
    actions: [
      a("task.clockin", "Clock into a task", "standard"),
      a("assignment.accept", "Accept an assignment", "standard"),
      a("safetyhold.override", "Override a safety hold", "critical"),
    ],
  },

  // ── Industrial (P2) — catalog entry; supply a decision to plan ──────────────
  {
    id: "mes-scada",
    name: "MES / SCADA-HMI",
    category: "Line operations",
    vertical: "industrial",
    workflowKey: "line-ops",
    actions: [
      a("line.status", "View line status", "standard", { gated: false }),
      a("event.ack", "Acknowledge an event", "standard"),
      a("setpoint.change", "Change a setpoint", "critical"),
      a("line.startstop", "Start / stop a line", "critical"),
      a("interlock.bypass", "Bypass a safety interlock", "critical"),
    ],
  },

  // ── Global fleet (P3) ───────────────────────────────────────────────────────
  {
    id: "tms-dispatch",
    name: "TMS / dispatch",
    category: "Transportation management",
    vertical: "global_fleet",
    workflowKey: "field-session",
    actions: [
      a("manifest.view", "View manifest", "standard", { gated: false }),
      a("load.accept", "Accept a load", "standard"),
      a("load.reassign", "Reassign a regulated load", "elevated"),
      a("crossregion.checkout", "Cross-region checkout", "critical"),
    ],
  },
  {
    id: "eld-hos",
    name: "ELD / hours-of-service",
    category: "Duty status",
    vertical: "global_fleet",
    workflowKey: "field-session",
    actions: [
      a("duty.start", "Start duty status", "standard"),
      a("log.edit", "Edit a duty log", "critical"),
      a("pc.override", "Personal-conveyance override", "critical"),
    ],
  },
  {
    id: "telematics",
    name: "Telematics",
    category: "Vehicle telematics",
    vertical: "global_fleet",
    workflowKey: "vehicle-checkout",
    actions: [
      a("vehicle.status", "View vehicle status", "standard", { gated: false }),
      a("immobilizer.release", "Remote immobilizer / seal release", "critical"),
    ],
  },

  // ── Retail (P4) — catalog entry; supply a decision to plan ──────────────────
  {
    id: "pos",
    name: "POS",
    category: "Point of sale",
    vertical: "retail",
    workflowKey: "pos-session",
    actions: [
      a("price.lookup", "Look up a price", "standard", { gated: false }),
      a("sale.ring", "Ring a sale", "standard"),
      a("drawer.nosale", "No-sale drawer open", "critical"),
      a("refund.void", "Manager void / refund", "critical"),
    ],
  },
  {
    id: "restricted-sale",
    name: "Age / rx-restricted",
    category: "Restricted sale",
    vertical: "retail",
    workflowKey: "restricted-sale",
    actions: [
      a("item.scan", "Scan an item", "standard"),
      a("agerestricted.approve", "Approve an age-restricted sale", "critical"),
      a("pharmacy.approve", "Approve a pharmacy sale", "critical"),
    ],
  },
];
