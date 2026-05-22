export interface SignalType {
  id: string;
  name: string;
  shortName: string;
  description: string;
  sharedDeviceExample: string;
  sourceExamples: string[];
  evaluationQuestion: string;
}

export interface DecisionOutcome {
  id: string;
  label: string;
  description: string;
  color: string;
  dot: string;
}

export const signalTypes: SignalType[] = [
  {
    id: "identity",
    name: "Identity",
    shortName: "Identity",
    description:
      "Who is authenticated to this session right now — not who owns the device. In shared-device environments, identity is ephemeral and session-scoped. The device may have been used by a different worker on the previous shift. SignalGrid evaluates identity at session time, not device enrollment time.",
    sharedDeviceExample:
      "Nurse Maria logs into a shared iOS medication cart at the start of her shift. Her identity token is fresh, her MFA was completed 4 minutes ago, and her role maps to the ward she's currently assigned to. The previous user's session has been cleared.",
    sourceExamples: ["Entra ID / Azure AD", "Okta", "ADFS", "Ping Identity"],
    evaluationQuestion:
      "Is the current authenticated identity valid, recently verified, and authorized for this context?",
  },
  {
    id: "device-posture",
    name: "Device Posture",
    shortName: "Device Posture",
    description:
      "The compliance and health state of the physical device at this moment. In shared environments, device posture drifts between users — a device may have been left in a non-compliant state by the previous worker. Posture is evaluated at access time, not at enrollment time.",
    sharedDeviceExample:
      "The shared scanner in the logistics bay is 14 days behind on OS patches. Its MDM compliance status is non-compliant. A delivery driver attempts to initiate a workflow. SignalGrid evaluates current posture and routes to a restricted-access outcome pending remediation.",
    sourceExamples: ["Microsoft Intune", "Jamf Pro", "VMware Workspace ONE", "CrowdStrike ZTA"],
    evaluationQuestion:
      "Is this device currently compliant, managed, and in an expected health state for this access context?",
  },
  {
    id: "session-context",
    name: "Session Context",
    shortName: "Session Context",
    description:
      "The operational context surrounding this session — shift assignment, location, time of day, role, and task context. In frontline environments, access patterns are highly contextual: a floor supervisor should not have the same access at 3am as during a scheduled shift. Session context is the signal that makes this distinction.",
    sharedDeviceExample:
      "A warehouse worker attempts to access a high-value inventory adjustment workflow at 02:30 — outside their assigned shift window. Session context signals an anomaly. SignalGrid triggers a step-up verification before allowing the access outcome.",
    sourceExamples: ["Shift scheduling systems", "Location services", "HRMS / workforce platforms", "Custom session metadata"],
    evaluationQuestion:
      "Does the current session context (time, location, role assignment, task scope) match expected access patterns?",
  },
  {
    id: "operational-signals",
    name: "Operational Signals",
    shortName: "Operational Signals",
    description:
      "Live signals from ITSM and workflow systems indicating the operational health of the environment. An open incident for a device, an active change freeze, a flagged asset — these are signals that existing IAM and MDM platforms don't natively consume. SignalGrid treats them as first-class inputs to the access decision.",
    sharedDeviceExample:
      "A field engineer attempts to use a shared device that has an open ServiceNow incident for hardware instability. The device is technically MDM-compliant and the identity is valid, but the operational signal indicates unreliable state. SignalGrid routes to a limited-access outcome until the incident is resolved.",
    sourceExamples: ["ServiceNow ITSM", "Jira Service Management", "Freshservice", "PagerDuty", "Custom incident APIs"],
    evaluationQuestion:
      "Are there active operational signals (incidents, change freezes, flagged assets) that should modify this access outcome?",
  },
];

export const decisionOutcomes: DecisionOutcome[] = [
  {
    id: "allow",
    label: "Allow",
    description: "All signals within expected parameters. Workflow proceeds.",
    color: "text-teal-400",
    dot: "bg-teal-500",
  },
  {
    id: "step-up",
    label: "Step-Up Verify",
    description: "One or more signals are anomalous. Additional verification required before workflow access.",
    color: "text-amber-400",
    dot: "bg-amber-500",
  },
  {
    id: "restrict",
    label: "Restrict",
    description: "Signal combination indicates elevated risk. Access limited to lower-sensitivity operations.",
    color: "text-orange-400",
    dot: "bg-orange-500",
  },
  {
    id: "deny",
    label: "Deny",
    description: "Signal combination falls outside acceptable parameters. Workflow access blocked.",
    color: "text-red-400",
    dot: "bg-red-600",
  },
];
