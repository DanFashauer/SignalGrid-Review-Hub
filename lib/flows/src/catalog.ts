// Public-safe demo flows — illustrating how DIFFERENT businesses would configure
// the same Grid: different signals, different automate-vs-approve mixes, and
// different break handling (self-heal via an agent, or an ITSM incident). These
// are examples an administrator would author, not hard-coded behaviour.

import type { Flow } from "./index";

export const DEMO_FLOWS: Flow[] = [
  // Healthcare: high assurance, human-in-the-loop. No self-heal — a broken signal
  // pages Clinical Ops (patient-safety-critical, a human must know).
  {
    id: "flow_med_admin",
    name: "Medication administration",
    description: "Controlled-substance administration on a shared clinical device.",
    requiredSignals: ["identity", "device_compliance", "badge_binding", "baseline"],
    actions: [
      { key: "bcma.open", label: "Open BCMA session", approval: "automated" },
      { key: "controlled.administer", label: "Administer controlled substance", approval: "dual_approval" },
      { key: "dose.override", label: "Override a dose warning", approval: "admin_approval" },
      { key: "downtime.paper_fallback", label: "Downtime paper-fallback administration", approval: "user_override_on_downtime", safetyNets: ["DR checkpoint", "post-hoc reconciliation", "witness required"] },
    ],
    supportTeam: "Clinical Ops",
    itsm: "servicedesk",
    severityOnBreak: "sev2",
  },

  // Data center / NOC: uptime-critical. Broken signal SELF-HEALS via a bot
  // (auto-resolves), so uptime is protected without waiting on a human.
  {
    id: "flow_network_change",
    name: "Network change",
    description: "Config push to a core network device from a NOC workstation.",
    requiredSignals: ["identity", "device_compliance", "baseline", "change_window"],
    actions: [
      { key: "config.stage", label: "Stage a config diff", approval: "automated" },
      { key: "config.push", label: "Push config to a core device", approval: "dual_approval" },
      { key: "power.cycle", label: "Power-cycle a rack / PDU", approval: "admin_approval" },
      { key: "downtime.emergency_rollback", label: "Emergency rollback", approval: "user_override_on_downtime", safetyNets: ["last-known-good snapshot", "auto-revert timer"] },
    ],
    supportTeam: "NOC",
    itsm: "opsgenie",
    severityOnBreak: "sev1",
    autoHeal: { agent: "config-rollback-bot", autoResolves: true },
  },

  // Warehouse: mostly automated, one approval. Broken signal tries a bot but the
  // bot does NOT auto-resolve, so an incident is still raised (self-heal + page).
  {
    id: "flow_controlled_area",
    name: "Controlled-area entry",
    description: "High-value / hazmat cage entry with a shared handheld.",
    requiredSignals: ["identity", "device_compliance", "custody"],
    actions: [
      { key: "gate.unlock", label: "Unlock zone gate", approval: "admin_approval" },
      { key: "cage.unlock", label: "Unlock high-value cage", approval: "dual_approval" },
      { key: "pick.confirm", label: "Confirm a pick", approval: "automated" },
    ],
    supportTeam: "Warehouse Ops",
    itsm: "servicenow",
    severityOnBreak: "sev3",
    autoHeal: { agent: "custody-reconcile-bot", autoResolves: false },
  },
];
