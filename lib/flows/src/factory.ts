// Manufacturing / factory-floor decision workflows — a self-contained pack.
//
// The OT posture dimension answers "how trustworthy is this industrial device?".
// These flows are what the Grid DOES about it: the same allow / step-up / restrict
// / deny discipline applied to plant-floor actions (a firmware push to a PLC, a
// line command from an HMI, an exposed OT device), owner- and accountability-
// governed, with the riskiest actions approval-gated and downtime overrides
// safety-netted so the line is never disrupted carelessly.
//
// Kept separate from DEMO_FLOWS so the shared demo grid's coverage math is
// untouched; this pack composes and is proven on its own (proof:factory-flows).
// Public-safe, illustrative — an administrator would author these, not the code.

import type { Flow } from "./index";
import type { GridSituation } from "./grid-coverage";
import type { SignalSource } from "./signal-sourcing";

export const FACTORY_FLOWS: Flow[] = [
  // Firmware/software change to a PLC — the highest-stakes plant action. Staging
  // is automated; the actual push is dual-approval; an emergency rollback is a
  // safety-netted downtime override so a bad flash never bricks the line.
  {
    id: "flow_plc_firmware",
    name: "PLC firmware update",
    description: "Firmware/software change pushed to a programmable logic controller on the line.",
    requiredSignals: ["identity", "ot", "change_window"],
    actions: [
      { key: "fw.stage", label: "Stage a firmware image", approval: "automated" },
      { key: "fw.push", label: "Push firmware to the PLC", approval: "dual_approval" },
      { key: "fw.rollback", label: "Emergency firmware rollback", approval: "user_override_on_downtime", safetyNets: ["last-known-good image", "auto-revert timer", "line-stop interlock"] },
    ],
    supportTeam: "OT Engineering",
    itsm: "servicenow",
    severityOnBreak: "sev1",
    autoHeal: { agent: "firmware-rollback-bot", autoResolves: false },
    owner: "OT Engineering",
    accountable: "Plant Risk Owner",
  },

  // A command issued to the production line from an operator HMI. Reading status
  // is automated; issuing a command needs admin approval; an e-stop override is a
  // safety-netted downtime action.
  {
    id: "flow_line_command",
    name: "Production line command",
    description: "An operator issues a control command to the line from a shared HMI.",
    requiredSignals: ["identity", "ot"],
    actions: [
      { key: "line.read", label: "Read line status", approval: "automated" },
      { key: "line.command", label: "Issue a line command", approval: "admin_approval" },
      { key: "line.estop_override", label: "Override an e-stop condition", approval: "user_override_on_downtime", safetyNets: ["supervisor witness", "post-hoc reconciliation"] },
    ],
    supportTeam: "Manufacturing Ops",
    itsm: "servicenow",
    severityOnBreak: "sev1",
    owner: "Manufacturing Engineering",
    accountable: "Plant Manager",
  },

  // Contain an OT device that is exposed (flat network / unauthenticated protocol /
  // unpatchable). Monitoring is automated; a restrict is admin-approved; a
  // segment/quarantine is dual-approval (it can stop a line).
  {
    id: "flow_ot_exposure",
    name: "OT exposure containment",
    description: "Contain an industrial device the Grid finds exposed or unpatchable.",
    requiredSignals: ["ot", "network"],
    actions: [
      { key: "ot.monitor", label: "Monitor an exposed device", approval: "automated" },
      { key: "ot.restrict", label: "Restrict the device's reachable services", approval: "admin_approval" },
      { key: "ot.segment", label: "Segment / quarantine the device", approval: "dual_approval" },
    ],
    supportTeam: "OT Security",
    itsm: "servicenow",
    severityOnBreak: "sev2",
    autoHeal: { agent: "ot-segment-bot", autoResolves: false },
    owner: "OT Security",
    accountable: "Plant Risk Owner",
  },
];

/** Factory-floor situations the Grid handles when the workflow is active + fed. */
export const FACTORY_SITUATIONS: readonly GridSituation[] = [
  { id: "sit_plc_firmware", label: "Unauthorized firmware push to a PLC", workflowId: "flow_plc_firmware" },
  { id: "sit_line_command", label: "Line command from an unmanaged HMI", workflowId: "flow_line_command" },
  { id: "sit_ot_exposed", label: "A PLC reachable from the office network", workflowId: "flow_ot_exposure" },
];

/** How the factory signals reach the Grid. OT device posture is grid-collected
 *  (read via the edge gateway — the device can't run an agent). */
export const FACTORY_SIGNAL_SOURCES: readonly SignalSource[] = [
  { id: "identity", name: "Identity / SSO sign-in risk", system: "Entra ID", method: "api" },
  { id: "ot", name: "OT / IIoT device posture", system: "OT edge gateway", method: "grid_collected" },
  { id: "change_window", name: "Approved change window", system: "ITSM", method: "native" },
  { id: "network", name: "Network / NAC segmentation", system: "NAC", method: "native" },
];
