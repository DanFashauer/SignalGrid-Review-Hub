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
  apiDocs?: string;
  quickstartSteps?: QuickstartStep[];
}

export interface QuickstartStep {
  title: string;
  code?: string;
  description: string;
}

export const integrationTargets: IntegrationTarget[] = [
  {
    id: "fleet",
    vendor: "Fleet",
    category: "MDM / UEM",
    product: "Fleet MDM + osquery",
    signalTypes: ["Device Posture"],
    status: "not-started",
    priority: "P1",
    notes:
      "Open-source MDM and device management platform with a full REST API. Fleet collects real-time device posture via osquery — OS version, patch compliance, disk encryption, running processes, installed software, and custom policy results. Purpose-built for cross-platform fleets (macOS, Windows, Linux, iOS via MDM). SOC2 Type 2 certified. Excellent first integration target: no licensing cost, live sandbox available, comprehensive REST API, fleetctl CLI for scripting.",
    blockers: undefined,
    apiDocs: "https://fleetdm.com/docs/rest-api/rest-api",
    quickstartSteps: [
      {
        title: "Install fleetctl CLI",
        code: `curl -sSL https://fleetdm.com/resources/install-fleetctl.sh | bash`,
        description: "Install the Fleet command-line tool. Used to configure Fleet, manage policies, and script API interactions.",
      },
      {
        title: "Connect to a Fleet instance (or start local sandbox)",
        code: `# Option A: connect to existing Fleet instance
fleetctl config set --address https://your-fleet.example.com --token YOUR_API_TOKEN

# Option B: start a local Fleet sandbox (Docker required)
fleetctl preview`,
        description:
          "fleetctl preview spins up a local Fleet instance with sample devices pre-enrolled. No infrastructure setup required for sandbox testing.",
      },
      {
        title: "List enrolled hosts (device inventory)",
        code: `# Via CLI
fleetctl get hosts --json

# Via REST API
curl -H "Authorization: Bearer YOUR_TOKEN" \\
  https://your-fleet.example.com/api/v1/fleet/hosts`,
        description:
          "Returns all enrolled devices with hardware details, OS version, last seen time, and MDM enrollment status. This is the device inventory signal input.",
      },
      {
        title: "Query device posture for a specific host",
        code: `# Get detailed host info including MDM status and policy results
curl -H "Authorization: Bearer YOUR_TOKEN" \\
  https://your-fleet.example.com/api/v1/fleet/hosts/:id

# Get policy pass/fail results for a host
curl -H "Authorization: Bearer YOUR_TOKEN" \\
  https://your-fleet.example.com/api/v1/fleet/hosts/:id/policies`,
        description:
          "Returns per-device policy results — which compliance checks passed, which failed, and when last evaluated. This is the core device posture signal for SignalGrid's decision engine.",
      },
      {
        title: "Create a custom posture policy",
        code: `# Example: disk encryption policy
fleetctl apply -f - <<EOF
apiVersion: v1
kind: policy
spec:
  name: "Disk encryption enabled"
  query: "SELECT 1 FROM disk_encryption WHERE encrypted = 1 LIMIT 1;"
  description: "Checks that disk encryption is enabled"
  resolution: "Enable FileVault (macOS) or BitLocker (Windows)"
  platform: "darwin,windows"
EOF`,
        description:
          "Define custom compliance policies using SQL-based osquery queries. Results feed directly into the device posture signal. Any osquery table is queryable — running processes, installed software, network connections, user accounts.",
      },
      {
        title: "Map Fleet policy results to SignalGrid device posture signal",
        code: `// SignalGrid integration pseudocode
async function getDevicePosture(deviceId: string) {
  const res = await fetch(
    \`\${FLEET_URL}/api/v1/fleet/hosts/\${deviceId}/policies\`,
    { headers: { Authorization: \`Bearer \${FLEET_TOKEN}\` } }
  );
  const { policies } = await res.json();

  const failingPolicies = policies.filter((p) => p.response === "fail");
  const complianceScore = policies.filter((p) => p.response === "pass").length / policies.length;

  return {
    signalType: "device-posture",
    deviceId,
    compliant: failingPolicies.length === 0,
    complianceScore,
    failingPolicies: failingPolicies.map((p) => p.name),
    evaluatedAt: new Date().toISOString(),
  };
}`,
        description:
          "Map Fleet's policy API response to the device posture signal schema that SignalGrid's decision engine consumes. A device with failing policies contributes a non-compliant posture signal.",
      },
    ],
  },
  {
    id: "intune",
    vendor: "Microsoft",
    category: "MDM / UEM",
    product: "Intune Device Compliance",
    signalTypes: ["Device Posture"],
    status: "in-progress",
    priority: "P1",
    notes:
      "Primary integration target for Microsoft-stack organizations. Device compliance status, managed device enrollment state, OS patch level. Critical for shared iOS/Android device posture evaluation in healthcare and logistics. Uses Microsoft Graph API.",
    blockers: "Intune Graph API scopes and certificate-based auth for shared device mode require M365 E3/E5 sandbox. Entra Shared Device Mode enrollment needed for iOS shared device scenarios.",
    apiDocs: "https://learn.microsoft.com/en-us/graph/api/intune-devices-manageddevice-list",
    quickstartSteps: [
      {
        title: "Register an app in Entra ID (Azure AD)",
        code: `# Required Graph API permissions:
# DeviceManagementManagedDevices.Read.All
# DeviceManagementConfiguration.Read.All
# Device.Read.All`,
        description:
          "Register a service principal in Entra ID with read-only Graph API permissions for device management. Use certificate credentials in production, client secret for sandbox.",
      },
      {
        title: "Get device compliance state via Graph API",
        code: `# List all managed devices with compliance state
GET https://graph.microsoft.com/v1.0/deviceManagement/managedDevices
  ?$select=id,deviceName,complianceState,osVersion,enrolledDateTime,lastSyncDateTime
  &$filter=complianceState ne 'compliant'

# Authorization header
Authorization: Bearer {access_token}`,
        description:
          "Returns managed device list filtered to non-compliant devices. complianceState values: compliant, noncompliant, unknown, notApplicable, inGracePeriod, conflict.",
      },
      {
        title: "Get compliance policy evaluation results for a device",
        code: `GET https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/{deviceId}/deviceCompliancePolicyStates
Authorization: Bearer {access_token}`,
        description:
          "Returns per-policy compliance evaluation for a specific device — which policies passed, failed, or haven't been evaluated yet.",
      },
    ],
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
      "Identity resolution, device registration state, conditional access policy evaluation context. Entra Shared Device Mode is the primary target for frontline iOS deployments (nurses, logistics workers, field engineers sharing one device across shifts).",
    blockers: "Entra Workload Identity Federation setup needed for service principal auth in sandbox.",
    apiDocs: "https://learn.microsoft.com/en-us/entra/identity-platform/",
    quickstartSteps: [
      {
        title: "Query current signed-in user identity",
        code: `GET https://graph.microsoft.com/v1.0/me
GET https://graph.microsoft.com/v1.0/me/authentication/methods
Authorization: Bearer {access_token}`,
        description:
          "Returns the currently authenticated user's identity, role assignments, and authentication method used in this session. Authentication method is the session context signal.",
      },
      {
        title: "Check device registration and join state",
        code: `GET https://graph.microsoft.com/v1.0/devices?$filter=displayName eq '{deviceName}'
  &$select=id,displayName,isCompliant,isManaged,trustType,registrationDateTime
Authorization: Bearer {access_token}`,
        description:
          "trustType values: Workplace (BYOD), AzureAd (Entra joined), ServerAd (Hybrid joined). isManaged indicates Intune enrollment. Combined with Intune compliance, this forms the full device posture signal.",
      },
    ],
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
      "Primary MDM platform for Apple-fleet healthcare and education environments. Device compliance, management profile status, smart group membership. REST API and webhook support. Classic API for legacy endpoints, Jamf Pro API (v1) for modern integrations.",
    apiDocs: "https://developer.jamf.com/jamf-pro/reference/get_v1-computers-management-id",
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
      "Identity provider for non-Microsoft enterprise environments. Okta Device Trust for managed device verification. Okta Workflows for signal-triggered policy actions. Systems of Record API for identity signal retrieval.",
    apiDocs: "https://developer.okta.com/docs/reference/",
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
      "Open incident or change record for a device is a first-class operational signal. Querying active incidents, change freeze windows, and device assignment state. Table API or IntegrationHub. REST API with basic auth or OAuth 2.0.",
    apiDocs: "https://developer.servicenow.com/dev.do#!/reference/api/tokyo/rest/c_TableAPI",
    quickstartSteps: [
      {
        title: "Query open incidents for a device",
        code: `GET https://{instance}.service-now.com/api/now/table/incident
  ?sysparm_query=cmdb_ci.name={deviceName}^active=true^state!=6
  &sysparm_fields=number,short_description,state,priority,opened_at,category
  &sysparm_limit=10
Authorization: Basic {base64(user:pass)}
Accept: application/json`,
        description:
          "Returns active incidents linked to a configuration item (device). state=6 is Resolved. priority 1-2 incidents are high-severity. An open P1/P2 incident for the requesting device should trigger a Restrict or Deny outcome.",
      },
    ],
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
      "CrowdStrike ZTA score as a device posture signal input. Relevant for environments where Falcon is already deployed — augments rather than replaces existing posture data. Falcon API with OAuth 2.0.",
    apiDocs: "https://falcon.crowdstrike.com/documentation/page/a2a7fc0e/crowdstrike-oauth2-based-apis",
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
      "Operational signal source for SMB and tech-adjacent environments. Open incidents, SLA breach events, device-linked tickets as access decision inputs. REST API with OAuth 2.0 or API token.",
    apiDocs: "https://developer.atlassian.com/cloud/jira/service-desk/rest/api-group-request/",
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
