export type IntegrationStatus =
  | "not-started"
  | "in-progress"
  | "sandbox-validated"
  | "demo-ready";

export interface IntegrationTarget {
  id: string;
  vendor: string;
  category: "Identity Provider" | "MDM / UEM" | "ITSM / Workflow" | "SIEM / Analytics";
  product: string;
  signalTypes: string[];
  status: IntegrationStatus;
  priority: "P1" | "P2" | "P3";
  notes: string;
  blockers?: string;
}

export const integrationTargets: IntegrationTarget[] = [
  {
    id: "intune",
    vendor: "Microsoft",
    category: "MDM / UEM",
    product: "Intune Device Compliance",
    signalTypes: ["Device Posture"],
    status: "in-progress",
    priority: "P1",
    notes:
      "Primary integration target. Device compliance status, managed device enrollment state, OS patch level. Critical for shared-device posture evaluation in healthcare and logistics.",
    blockers: "Intune Graph API scopes and certificate-based auth for shared device mode require M365 E3/E5 sandbox.",
  },
  {
    id: "entra",
    vendor: "Microsoft",
    category: "Identity Provider",
    product: "Entra ID (Azure AD)",
    signalTypes: ["Identity", "Device Posture", "Session Context"],
    status: "in-progress",
    priority: "P1",
    notes:
      "Identity resolution, device registration state, conditional access policy evaluation context. Entra Shared Device Mode is the primary target for frontline iOS deployments.",
    blockers: "Entra Workload Identity Federation setup needed for service principal auth in sandbox.",
  },
  {
    id: "jamf",
    vendor: "Jamf",
    category: "MDM / UEM",
    product: "Jamf Pro",
    signalTypes: ["Device Posture"],
    status: "not-started",
    priority: "P2",
    notes:
      "Primary MDM platform for Apple-fleet healthcare and education environments. Device compliance, management profile status, smart group membership. REST API and webhook support.",
  },
  {
    id: "okta",
    vendor: "Okta",
    category: "Identity Provider",
    product: "Okta Identity + Device Trust",
    signalTypes: ["Identity", "Session Context"],
    status: "not-started",
    priority: "P2",
    notes:
      "Identity provider for non-Microsoft enterprise environments. Okta Device Trust for managed device verification. Okta Workflows for signal-triggered policy actions.",
  },
  {
    id: "servicenow",
    vendor: "ServiceNow",
    category: "ITSM / Workflow",
    product: "Now Platform (ITSM)",
    signalTypes: ["Operational Signals"],
    status: "not-started",
    priority: "P2",
    notes:
      "Open incident or change record for a device is a first-class operational signal. Querying active incidents, change freeze windows, and device assignment state. Table API or IntegrationHub.",
  },
  {
    id: "crowdstrike",
    vendor: "CrowdStrike",
    category: "SIEM / Analytics",
    product: "Falcon Zero Trust Assessment",
    signalTypes: ["Device Posture"],
    status: "not-started",
    priority: "P3",
    notes:
      "CrowdStrike ZTA score as a device posture signal input. Relevant for environments where Falcon is already deployed — augments rather than replaces existing posture data. Falcon API.",
  },
  {
    id: "jira",
    vendor: "Atlassian",
    category: "ITSM / Workflow",
    product: "Jira Service Management",
    signalTypes: ["Operational Signals"],
    status: "not-started",
    priority: "P3",
    notes:
      "Operational signal source for SMB and tech-adjacent environments. Open incidents, SLA breach events, device-linked tickets as access decision inputs.",
  },
];

export const integrationStatusMeta: Record<
  IntegrationStatus,
  { label: string; color: string; dot: string; bg: string }
> = {
  "not-started": {
    label: "Not Started",
    color: "text-stone-500",
    dot: "bg-stone-600",
    bg: "bg-stone-900/40",
  },
  "in-progress": {
    label: "In Progress",
    color: "text-amber-400",
    dot: "bg-amber-500",
    bg: "bg-amber-900/20",
  },
  "sandbox-validated": {
    label: "Sandbox Validated",
    color: "text-teal-400",
    dot: "bg-teal-500",
    bg: "bg-teal-900/20",
  },
  "demo-ready": {
    label: "Demo Ready",
    color: "text-emerald-400",
    dot: "bg-emerald-500",
    bg: "bg-emerald-900/20",
  },
};
