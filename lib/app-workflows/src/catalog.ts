// Public-safe catalog of integrated application workflows, by vertical.
//
// These are generic app CATEGORIES (never a real vendor/product name) with the
// kinds of actions people perform in them. `workflowKey` is the decision-core
// workflow the app's session maps to; all six verticals now have a seeded demo
// tenant (healthcare / warehouse / global-fleet / retail / industrial /
// data-center-NOC), so every catalog here evaluates against a live decision.
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

  // ── Industrial (P2) ─────────────────────────────────────────────────────────
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

  // ── Retail (P4) ─────────────────────────────────────────────────────────────
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

  // ── Data center / NOC (P5) — uptime is the north star ────────────────────────
  // The uptime-affecting actions (execute a change, push config, power-cycle,
  // failover, freeze bypass) are the highest-consequence in the whole catalog:
  // they must never run from an unverified device/context. They are `critical`
  // → always sensitive (held for confirmation on allow, step-up when required,
  // blocked under restriction/deny). Reads and acks stay available so a NOC can
  // always SEE, even when it may not ACT.
  {
    id: "dcim-change",
    name: "DCIM / change mgmt",
    category: "Data-center infrastructure",
    vertical: "data_center",
    workflowKey: "noc-session",
    actions: [
      a("topology.view", "View topology / capacity", "standard", { gated: false }),
      a("change.open", "Open a change record", "elevated"),
      a("change.execute", "Execute a change", "critical"),
      a("freeze.bypass", "Bypass a change freeze", "critical"),
    ],
  },
  {
    id: "network-config",
    name: "Network config",
    category: "Network control",
    vertical: "data_center",
    workflowKey: "network-change",
    actions: [
      a("config.view", "View running config", "standard", { gated: false }),
      a("diff.stage", "Stage a config diff", "elevated"),
      a("config.push", "Push config to a core device", "critical"),
      a("acl.change", "Change an ACL / route", "critical"),
    ],
  },
  {
    id: "power-pdu",
    name: "Power / PDU",
    category: "Power control",
    vertical: "data_center",
    workflowKey: "power-control",
    actions: [
      a("draw.read", "Read power draw / breakers", "standard", { gated: false }),
      a("rack.powercycle", "Power-cycle a rack / PDU", "critical"),
      a("load.shed", "Shed load", "critical"),
    ],
  },
  {
    id: "itsm-incident",
    name: "ITSM / incident",
    category: "Incident management",
    vertical: "data_center",
    workflowKey: "incident-response",
    actions: [
      a("ticket.view", "View a ticket", "standard", { gated: false }),
      a("status.update", "Update ticket status", "standard"),
      a("sev1.declare", "Declare / resolve a Sev-1", "critical"),
      a("execbridge.page", "Page an exec bridge", "critical"),
    ],
  },
  {
    id: "cooling-bms",
    name: "Cooling / BMS",
    category: "Facilities control",
    vertical: "data_center",
    workflowKey: "facilities-control",
    actions: [
      a("sensor.read", "Read sensors", "standard", { gated: false }),
      a("bms.ack", "Acknowledge a BMS event", "standard"),
      a("setpoint.change", "Change a cooling setpoint", "critical"),
      a("interlock.override", "Override a safety interlock", "critical"),
    ],
  },
  {
    id: "compute-orchestration",
    name: "Compute / orchestration",
    category: "Compute control",
    vertical: "data_center",
    workflowKey: "compute-ops",
    actions: [
      a("node.view", "View nodes / clusters", "standard", { gated: false }),
      a("node.drain", "Drain a node", "critical"),
      a("failover.trigger", "Trigger a failover", "critical"),
      a("cluster.cordon", "Cordon a cluster", "critical"),
    ],
  },

  // ── Government / public sector ──────────────────────────────────────────────
  {
    id: "case-management",
    name: "Benefits / case management",
    category: "Public benefits",
    vertical: "government",
    workflowKey: "gov-case-session",
    actions: [
      a("case.open", "Open a constituent case", "elevated"),
      a("record.view", "View benefits / eligibility record", "elevated"),
      a("note.document", "Document a case note", "standard"),
      a("eligibility.adjudicate", "Adjudicate eligibility", "critical"),
      a("payment.release", "Release a benefit payment", "critical"),
    ],
  },
  {
    id: "secure-facility",
    name: "Secure facility access",
    category: "Physical access control",
    vertical: "government",
    workflowKey: "gov-facility-access",
    actions: [
      a("badge.verify", "Verify badge / credential", "standard", { gated: false }),
      a("door.request", "Request door unlock", "elevated"),
      a("restricted.enter", "Enter a restricted zone", "critical"),
      a("escort.authorize", "Authorize a visitor escort", "critical"),
    ],
  },
];
