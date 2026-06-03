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
    priority: "P2",
    notes:
      "Open-source MDM and device management platform with a full REST API. Fleet collects real-time device posture via osquery — OS version, patch compliance, disk encryption, running processes, installed software, and custom policy results. Purpose-built for cross-platform fleets (macOS, Windows, Linux, iOS via MDM). Fleet remains a strong follow-on UEM/device-management connector path and a useful config-profile/remediation scaffolding reference after the Microsoft Intune / Entra posture proof; it is not the current first proof.",
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
      "First concrete posture proof for Microsoft-stack organizations. Device compliance status, managed device enrollment state, OS patch level, last sync/check-in freshness, and Entra device context become normalized SignalGrid posture inputs for allow / step-up / deny / unknown decisions and audit records. Uses Microsoft Graph API in a sandbox or deterministic fixture path; no production-ready, compliance, or Microsoft replacement claim.",
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
      "Primary MDM platform for Apple-fleet healthcare and education environments. Device compliance, management profile status, smart group membership. REST API and webhook support. Classic API for legacy endpoints, Jamf Pro API (v1) for modern integrations. Sandbox available via Jamf Developer Program (free trial tenant).",
    apiDocs: "https://developer.jamf.com/jamf-pro/reference/get_v1-computers-management-id",
    quickstartSteps: [
      {
        title: "Get a Jamf Pro trial or developer sandbox",
        code: `# Jamf Developer Program: developer.jamf.com
# Free trial tenant includes API access
# Credentials: Settings > Jamf Pro User Accounts & Groups`,
        description:
          "Jamf offers a developer sandbox via the Jamf Developer Program. A 60-day trial tenant includes full API access. Alternatively, use a Jamf School or Jamf Now trial for basic MDM concepts.",
      },
      {
        title: "Authenticate — get a Bearer token",
        code: `# Jamf Pro API v1 uses Bearer token auth
curl -X POST "https://yourinstance.jamfcloud.com/api/v1/auth/token" \\
  -u "api_user:api_password"

# Response includes token + expiration
# { "token": "...", "expires": "2026-05-23T..." }`,
        description:
          "The Jamf Pro API v1 uses short-lived Bearer tokens (30 min default). Refresh with /api/v1/auth/keep-alive or re-authenticate. The Classic API uses Basic auth — prefer v1 for new integrations.",
      },
      {
        title: "Get computer management details (device posture)",
        code: `# Get management state for a specific computer
curl -H "Authorization: Bearer YOUR_TOKEN" \\
  "https://yourinstance.jamfcloud.com/api/v1/computers-management/{id}"

# Check MDM capable, profile status, compliance policies
# Key fields: mdmCapable, managementId, osVersion`,
        description:
          "Returns MDM enrollment state, management profile status, and OS version for the device. MDM-capable + enrolled + management profile valid = compliant posture baseline.",
      },
      {
        title: "Query computer compliance policy status",
        code: `# Classic API: get computer details including policy compliance
curl -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Accept: application/json" \\
  "https://yourinstance.jamfcloud.com/JSSResource/computers/id/{id}/subset/Software"

# Smart group membership = compliance grouping
# GET /JSSResource/computergroups/id/{smartGroupId} for group membership`,
        description:
          "Smart group membership in Jamf is the primary compliance signal. A device in a 'Non-Compliant Devices' smart group is the Jamf equivalent of an Intune non-compliant device — the same posture signal, different platform.",
      },
      {
        title: "Map Jamf compliance state to SignalGrid device posture signal",
        code: `// Map Jamf computer details to SignalGrid device posture signal
async function getJamfDevicePosture(computerId: string) {
  const [details, policies] = await Promise.all([
    fetch(\`\${JAMF_URL}/api/v1/computers-management/\${computerId}\`, {
      headers: { Authorization: \`Bearer \${TOKEN}\` },
    }).then(r => r.json()),
    fetch(\`\${JAMF_URL}/JSSResource/computers/id/\${computerId}/subset/General\`, {
      headers: { Authorization: \`Bearer \${TOKEN}\`, Accept: 'application/json' },
    }).then(r => r.json()),
  ]);

  return {
    signalType: "device-posture",
    deviceId: computerId,
    compliant: details.mdmCapable && details.managementId != null,
    platform: "jamf",
    osVersion: details.osVersion,
    managementState: details.managementId ? "managed" : "unmanaged",
    evaluatedAt: new Date().toISOString(),
  };
}`,
        description:
          "Jamf's posture signal maps directly to SignalGrid's device-posture signal type. MDM-capable + management profile valid = posture compliant. Smart group membership adds fine-grained policy compliance on top.",
      },
    ],
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
      "Identity provider for non-Microsoft enterprise environments. Okta Device Trust for managed device verification. Okta Workflows for signal-triggered policy actions. Developer sandbox available free at developer.okta.com — no credit card required. Full REST API with API token or OAuth 2.0.",
    apiDocs: "https://developer.okta.com/docs/reference/",
    quickstartSteps: [
      {
        title: "Create a free Okta developer org",
        code: `# Free forever developer sandbox at:
# developer.okta.com/signup
# Full API access, no credit card, no expiry
# Includes Okta Verify, Device Trust, and Workflows`,
        description:
          "Okta's developer org is the easiest enterprise IdP sandbox to set up — no enterprise agreement, no infrastructure. Create a test user and an application to issue access tokens against.",
      },
      {
        title: "Get user profile and authentication methods",
        code: `# Get user details — identity signal
curl -H "Authorization: SSWS YOUR_API_TOKEN" \\
  "https://yourorg.okta.com/api/v1/users/{userId}"

# Get current active sessions for a user
curl -H "Authorization: SSWS YOUR_API_TOKEN" \\
  "https://yourorg.okta.com/api/v1/users/{userId}/sessions"`,
        description:
          "Returns the user's profile, status, and current active sessions. Active session count + last password change + MFA factors enrolled = the identity signal. Multiple concurrent sessions = session context anomaly.",
      },
      {
        title: "Get authentication factors (MFA state)",
        code: `# List enrolled MFA factors for a user
curl -H "Authorization: SSWS YOUR_API_TOKEN" \\
  "https://yourorg.okta.com/api/v1/users/{userId}/factors"

# Response includes factor type, status, and last verified time
# factorType: token:software:totp, push, webauthn, etc.`,
        description:
          "MFA factor enrollment and last verification time is a session context signal. A session authenticated with hardware key (WebAuthn) carries higher assurance than one authenticated with email OTP. SignalGrid can weight authentication method as part of the identity signal.",
      },
      {
        title: "Get device enrollment state (Okta Device Trust)",
        code: `# List devices enrolled in Okta Device Trust
curl -H "Authorization: SSWS YOUR_API_TOKEN" \\
  "https://yourorg.okta.com/api/v1/devices"

# Filter by user
curl -H "Authorization: SSWS YOUR_API_TOKEN" \\
  "https://yourorg.okta.com/api/v1/users/{userId}/devices"

# status: ACTIVE | INACTIVE | DEACTIVATED
# management: MANAGED | REGISTERED | NOT_REGISTERED`,
        description:
          "Returns device enrollment state and management status for devices tied to a user's Okta identity. status=ACTIVE + management=MANAGED = device trust verified. This is the Okta-side device posture signal that complements Intune/Jamf compliance data.",
      },
      {
        title: "Map Okta user + device trust to SignalGrid signals",
        code: `// Map Okta identity + device trust to SignalGrid signal types
async function getOktaSignals(userId: string) {
  const [user, sessions, devices] = await Promise.all([
    fetch(\`\${OKTA_URL}/api/v1/users/\${userId}\`, HEADERS).then(r => r.json()),
    fetch(\`\${OKTA_URL}/api/v1/users/\${userId}/sessions\`, HEADERS).then(r => r.json()),
    fetch(\`\${OKTA_URL}/api/v1/users/\${userId}/devices\`, HEADERS).then(r => r.json()),
  ]);

  const managedDevices = devices.filter((d: any) => d.profile.management === "MANAGED");

  return {
    identity: {
      signalType: "identity",
      userId,
      status: user.status,     // ACTIVE | SUSPENDED | DEACTIVATED
      activeSessions: sessions.length,
      lastLogin: user.lastLogin,
    },
    devicePosture: {
      signalType: "device-posture",
      hasManagedDevice: managedDevices.length > 0,
      managedDeviceCount: managedDevices.length,
    },
    sessionContext: {
      signalType: "session-context",
      concurrentSessions: sessions.length,
      anomalousSessionOverlap: sessions.length > 2,
    },
  };
}`,
        description:
          "Okta contributes three of SignalGrid's four signal types: identity (user status, last login), device posture (Device Trust enrollment and management state), and session context (concurrent session count, authentication method). The operational signals layer comes from ServiceNow or Jira.",
      },
    ],
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

  // ── Gartner Peer Insights additions ───────────────────────────────────────

  {
    id: "workspace-one",
    vendor: "Omnissa (VMware)",
    category: "MDM / UEM",
    product: "Workspace ONE UEM",
    signalTypes: ["Device Posture", "Session Context"],
    status: "not-started",
    priority: "P1",
    notes:
      "Former VMware AirWatch, now Omnissa. The dominant UEM platform for large-enterprise and kiosk/frontline device deployments. Native support for iOS Shared Device Mode, Android Enterprise Dedicated Devices, and Windows kiosk configurations — the exact shared-device scenarios SignalGrid targets. Strong REST API with device compliance, enrollment status, and user-device assignment. Gartner: 409 ratings, 4.3 stars.",
    apiDocs: "https://developer.omnissa.com/workspace-one-uem-apis/",
    quickstartSteps: [
      {
        title: "Get sandbox access — Omnissa Tech Zone or trial tenant",
        code: `# Option A: Omnissa Tech Zone (free developer labs)
# techzone.omnissa.com → Labs → Workspace ONE UEM
# Pre-configured tenant with sample devices

# Option B: 30-day trial tenant
# omnissa.com/products/workspace-one → Start Free Trial
# Credentials: Settings > System > Enterprise Integration > REST API`,
        description:
          "Omnissa Tech Zone provides free lab environments with pre-enrolled devices. Trial tenants also provide full API access. Navigate to Settings → Advanced → API → REST API to find your API key and server URL.",
      },
      {
        title: "Authenticate — get session token or use API key",
        code: `# Option A: Basic auth + tenant code header
curl -X POST "https://TENANT.awmdm.com/api/system/users/authenticate" \\
  -H "Authorization: Basic BASE64(user:pass)" \\
  -H "aw-tenant-code: YOUR_TENANT_CODE" \\
  -H "Content-Type: application/json"

# Option B: OAuth 2.0 client credentials (recommended)
curl -X POST "https://na.uemauth.vmwservices.com/connect/token" \\
  -d "grant_type=client_credentials&client_id=ID&client_secret=SECRET"`,
        description:
          "The `aw-tenant-code` header is Workspace ONE's API key — found in the UEM console under Settings → Advanced → API. OAuth is the modern auth path for new integrations.",
      },
      {
        title: "Query device compliance state",
        code: `# Get device details by serial number (device posture)
curl -H "Authorization: Bearer TOKEN" \\
  -H "aw-tenant-code: TENANT_CODE" \\
  "https://TENANT.awmdm.com/api/v1/mdm/devices?searchby=Serialnumber&id=SERIAL"

# Key compliance fields in response:
# ComplianceStatus: "Compliant" | "NonCompliant" | "Unknown"
# EnrollmentStatus: "Enrolled" | "Unenrolled" | "Pending"
# IsDeviceDNDEnabled (Do Not Disturb — operational signal)
# LastSeen (session context — last active timestamp)`,
        description:
          "Returns full device health including ComplianceStatus, EnrollmentStatus, managed app count, and LastSeen timestamp. ComplianceStatus=NonCompliant is the primary device posture signal for SignalGrid.",
      },
      {
        title: "Query user-device assignment (session context)",
        code: `# Get devices assigned to a specific user
curl -H "Authorization: Bearer TOKEN" \\
  -H "aw-tenant-code: TENANT_CODE" \\
  "https://TENANT.awmdm.com/api/v1/mdm/devices/search?user={username}"

# For kiosk/shared devices, check:
# IsSharedDevice: true/false (iOS Shared Device Mode)
# CheckedOutByUserId (current session user for shared devices)
# LastCheckIn (session context — when this user last checked in)`,
        description:
          "For shared devices in iOS Shared Device Mode or Android Dedicated Device mode, `IsSharedDevice` and `CheckedOutByUserId` are the session context signals. The checked-out user differs from the device enrollment owner — this is the shared-device gap that existing Conditional Access can't see.",
      },
      {
        title: "Map Workspace ONE compliance to SignalGrid signals",
        code: `// Map Workspace ONE device to SignalGrid signal payload
async function getWorkspaceOneSignals(serial: string, username: string) {
  const [device, userDevices] = await Promise.all([
    fetch(\`\${WS1_URL}/api/v1/mdm/devices?searchby=Serialnumber&id=\${serial}\`, HEADERS)
      .then(r => r.json()),
    fetch(\`\${WS1_URL}/api/v1/mdm/devices/search?user=\${username}\`, HEADERS)
      .then(r => r.json()),
  ]);

  const lastSeen = new Date(device.LastSeen);
  const hoursSinceLastSeen = (Date.now() - lastSeen.getTime()) / 3_600_000;

  return {
    devicePosture: {
      signalType: "device-posture",
      compliant: device.ComplianceStatus === "Compliant",
      enrolled: device.EnrollmentStatus === "Enrolled",
      platform: "workspace-one",
      complianceStatus: device.ComplianceStatus,
    },
    sessionContext: {
      signalType: "session-context",
      isSharedDevice: device.IsSharedDevice,
      checkedOutBy: device.CheckedOutByUserId,
      hoursSinceLastActivity: Math.round(hoursSinceLastSeen),
      sessionAnomalous: hoursSinceLastSeen < 0.5,
    },
  };
}`,
        description:
          "Workspace ONE contributes both device posture (ComplianceStatus) and session context (IsSharedDevice, CheckedOutByUserId, LastSeen). The session context signals are uniquely valuable for shared-device scenarios — they expose the per-user session layer that standard Conditional Access doesn't see.",
      },
    ],
  },

  {
    id: "tanium",
    vendor: "Tanium",
    category: "MDM / UEM",
    product: "Tanium Autonomous IT Platform",
    signalTypes: ["Device Posture", "Operational Signals"],
    status: "not-started",
    priority: "P1",
    notes:
      "Real-time endpoint management and security platform used by large enterprises. Tanium's core capability — asking structured questions about device state and getting answers in seconds from any managed endpoint — maps directly to SignalGrid's operational signals layer. Unlike passive MDM inventory, Tanium provides live answers: 'what processes are running on this device right now?', 'is this service healthy?'. Gartner: 142 ratings, 4.6 stars. Gartner willingness-to-recommend winner.",
    apiDocs: "https://developer.tanium.com/",
    quickstartSteps: [
      {
        title: "Access Tanium — trial or Tanium Playground",
        code: `# Option A: Tanium 30-day trial
# tanium.com/free-trial → cloud deployment
# Full API access included

# Option B: Tanium Playground (interactive demo environment)
# developer.tanium.com → Playground
# Pre-populated endpoints for API exploration

# Generate API token: Administration → API Tokens → New Token`,
        description:
          "Tanium's cloud trial includes full REST API access. The Tanium Playground provides a zero-setup environment for exploring the question/answer model before committing to a trial deployment.",
      },
      {
        title: "Authenticate with API token",
        code: `# All Tanium API calls use session header
curl -H "session: YOUR_API_TOKEN" \\
  "https://YOUR_TANIUM_HOST/api/v2/endpoints?count=10"

# Verify connection
curl -H "session: YOUR_API_TOKEN" \\
  "https://YOUR_TANIUM_HOST/api/v2/status"`,
        description:
          "Tanium uses a `session` header (not `Authorization`) for API token auth. API tokens are scoped to specific Tanium personas and permissions — create a read-only persona for the SignalGrid integration.",
      },
      {
        title: "List endpoints and get device state",
        code: `# Get all managed endpoints
curl -H "session: TOKEN" \\
  "https://TANIUM_HOST/api/v2/endpoints?count=25&fields=id,name,ipAddress,os,status"

# Get specific endpoint details
curl -H "session: TOKEN" \\
  "https://TANIUM_HOST/api/v2/endpoints/{endpoint_id}"

# Key fields: status (online/offline), lastRegistration, os.platform
# compliance: patch level, policy violations`,
        description:
          "Returns endpoint inventory with online/offline status and OS details. `lastRegistration` is the session context signal — endpoints that haven't checked in recently indicate a potential disconnected or compromised state.",
      },
      {
        title: "Ask a real-time question (live operational signal)",
        code: `# Ask a Tanium Question — real-time query to all managed endpoints
# POST /api/v2/questions
curl -X POST -H "session: TOKEN" \\
  -H "Content-Type: application/json" \\
  "https://TANIUM_HOST/api/v2/questions" \\
  -d '{
    "queryText": "Get Running Services from computers where Computer Name contains \"DEVICE-123\"",
    "expire": 30
  }'

# Get results (poll until complete or mrPassed = mrAvailable)
curl -H "session: TOKEN" \\
  "https://TANIUM_HOST/api/v2/result_data/question/{question_id}"`,
        description:
          "This is Tanium's unique capability: a live query to a specific endpoint that returns current state in under 15 seconds. For SignalGrid, this means 'is this endpoint's required security service currently running?' is an answerable question at access decision time — not just at last scan time.",
      },
      {
        title: "Map Tanium operational signals to SignalGrid",
        code: `// SignalGrid adapter: Tanium real-time operational signals
async function getTaniumOperationalSignals(endpointName: string) {
  // Ask question about running services on the target endpoint
  const question = await fetch(\`\${TANIUM_URL}/api/v2/questions\`, {
    method: "POST",
    headers: { session: TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({
      queryText: \`Get Running Services from computers where Computer Name contains "\${endpointName}"\`,
      expire: 30,
    }),
  }).then(r => r.json());

  // Poll for results (simplified — real impl uses polling loop)
  const results = await poll(\`/api/v2/result_data/question/\${question.data.id}\`);

  const requiredServices = ["SentinelOne", "CrowdStrike", "McAfee", "Defender"];
  const runningServices = results.data.flatMap((r: any) => r.rows.map((row: any) => row[0]));
  const missingServices = requiredServices.filter(s => !runningServices.some(r => r.includes(s)));

  return {
    signalType: "operational-signals",
    platform: "tanium",
    endpointName,
    requiredServicesMissing: missingServices,
    operationalSignal: missingServices.length > 0 ? "security-agent-absent" : "nominal",
    evaluatedAt: new Date().toISOString(),
  };
}`,
        description:
          "Tanium's real-time question model lets SignalGrid ask 'is the required security agent running right now?' at workflow execution time. A missing required service (CrowdStrike, Defender, SentinelOne) becomes an operational signal that triggers a Step-Up or Restrict outcome — independent of the device's MDM compliance status.",
      },
    ],
  },

  {
    id: "hexnode",
    vendor: "Mitsogo (Hexnode)",
    category: "MDM / UEM",
    product: "Hexnode UEM",
    signalTypes: ["Device Posture", "Session Context"],
    status: "not-started",
    priority: "P2",
    notes:
      "Purpose-built UEM for kiosk mode and frontline shared-device deployments. Hexnode has native API fields for kiosk mode status — whether a device is currently in locked-down single-app or multi-app kiosk mode — that most MDM platforms don't expose at this granularity. Strong fit for retail POS terminals, logistics kiosks, and healthcare nursing station devices. 30-day free trial, no credit card. Gartner: 260 ratings, 4.7 stars.",
    apiDocs: "https://www.hexnode.com/mobile-device-management/hexnode-mdm-api/",
    quickstartSteps: [
      {
        title: "Start a free Hexnode trial (no credit card required)",
        code: `# Sign up at: hexnode.com → Start Free Trial (30 days)
# Full API access included
# Get API key: Admin → API Access → Generate API Key
# Base URL: https://SUBDOMAIN.hexnodemdm.com/api/v1/`,
        description:
          "Hexnode's free trial is the easiest MDM sandbox to set up — no credit card, no infrastructure, and the API key is available immediately in the admin console under Admin → API Access.",
      },
      {
        title: "List enrolled devices",
        code: `# List all enrolled devices
curl -H "Authorization: YOUR_API_KEY" \\
  "https://SUBDOMAIN.hexnodemdm.com/api/v1/devices/"

# Response includes:
# device_name, os_type, enrollment_status
# last_reported (session context signal)
# battery_level (device health — operational signal)`,
        description:
          "The devices list returns enrollment status and last_reported timestamp. For kiosk devices, last_reported is a key session context signal — a device not reporting for more than one expected shift cycle is an anomaly worth flagging.",
      },
      {
        title: "Get device details including kiosk mode state",
        code: `# Get full device details — includes kiosk status
curl -H "Authorization: YOUR_API_KEY" \\
  "https://SUBDOMAIN.hexnodemdm.com/api/v1/device/{device_id}/"

# Key SignalGrid-relevant fields:
# enrolled_status: "enrolled" | "unenrolled" | "pending"
# kiosk_status: "kiosk_on" | "kiosk_off"  ← unique to Hexnode
# compliance_status: "compliant" | "non_compliant"
# battery_level: 0-100 (low battery = operational signal)
# last_reported: ISO timestamp (session context)`,
        description:
          "kiosk_status is Hexnode's unique differentiator — most MDMs don't expose whether a device is currently in kiosk lockdown at the API level. For SignalGrid, kiosk_status='kiosk_off' on a device that should be in kiosk mode is an operational anomaly signal that can trigger a Restrict outcome.",
      },
      {
        title: "Query compliance details",
        code: `# Get compliance detail for a device
curl -H "Authorization: YOUR_API_KEY" \\
  "https://SUBDOMAIN.hexnodemdm.com/api/v1/device/{device_id}/compliancedetail/"

# Response: list of compliance rules and their pass/fail status
# Each rule: policy_name, status (compliant/non_compliant), severity
# Rules typically cover: encryption, passcode, OS version, jailbreak`,
        description:
          "Returns a per-rule compliance breakdown: encryption policy, passcode requirement, minimum OS version, jailbreak/root detection. This granularity lets SignalGrid map specific compliance failure types to specific access outcomes — a jailbroken device gets Deny, an OS version gap gets Restrict.",
      },
      {
        title: "Map Hexnode signals to SignalGrid — kiosk and compliance",
        code: `// Hexnode → SignalGrid signal mapping
async function getHexnodeSignals(deviceId: string) {
  const [device, compliance] = await Promise.all([
    fetch(\`\${HEXNODE_URL}/api/v1/device/\${deviceId}/\`, HEADERS).then(r => r.json()),
    fetch(\`\${HEXNODE_URL}/api/v1/device/\${deviceId}/compliancedetail/\`, HEADERS).then(r => r.json()),
  ]);

  const failedRules = compliance.results.filter((r: any) => r.status === "non_compliant");
  const criticalFail = failedRules.find((r: any) =>
    ["jailbreak", "encryption", "passcode"].some(k => r.policy_name.toLowerCase().includes(k))
  );

  return {
    devicePosture: {
      signalType: "device-posture",
      compliant: device.compliance_status === "compliant",
      failedRuleCount: failedRules.length,
      hasCriticalFailure: !!criticalFail,
      criticalRule: criticalFail?.policy_name ?? null,
    },
    operationalSignal: {
      signalType: "operational-signals",
      kioskModeActive: device.kiosk_status === "kiosk_on",
      kioskModeAnomaly: device.kiosk_status === "kiosk_off",
      batteryLow: device.battery_level < 15,
    },
    sessionContext: {
      signalType: "session-context",
      lastReported: device.last_reported,
      staleDevice: isStaleDevice(device.last_reported),
    },
  };
}`,
        description:
          "Hexnode provides all three non-identity signal types. The kiosk mode anomaly (kiosk_status='kiosk_off' on a device that should be locked down) is the highest-value operational signal for retail and logistics shared-device environments — it's invisible to Conditional Access and most IAM policies.",
      },
    ],
  },

  {
    id: "maas360",
    vendor: "IBM",
    category: "MDM / UEM",
    product: "IBM Security MaaS360",
    signalTypes: ["Device Posture", "Identity"],
    status: "not-started",
    priority: "P2",
    notes:
      "Enterprise mobility management platform with strong traction in regulated industries: healthcare, financial services, and government. Native integration with IBM Security products (QRadar, Verify). Built-in threat management and compliance reporting. Relevant for SignalGrid's regulated-industry ICP. 30-day trial includes API access. Gartner: 189 ratings, 4.4 stars.",
    apiDocs: "https://www.ibm.com/docs/en/maas360",
    quickstartSteps: [
      {
        title: "Get a MaaS360 trial and API credentials",
        code: `# Start 30-day trial: ibm.com/products/maas360
# After setup: Portal → Setup → Advanced → MaaS360 WS API
# Note your: billingID, username, password, appID, appVersion, platformID, appAccessKey`,
        description:
          "MaaS360's authentication uses a multi-field credential set (not just a token). Locate all seven credential fields in the MaaS360 portal under Setup → Advanced → MaaS360 WS API. These are required for the authentication call.",
      },
      {
        title: "Authenticate — get a session auth token",
        code: `# MaaS360 uses form-encoded authentication
curl -X POST "https://services.fiberlink.com/auth-apis/auth/1.0/authenticate" \\
  -H "Content-Type: application/json" \\
  -d '{
    "billingID": "YOUR_BILLING_ID",
    "username": "YOUR_USERNAME",
    "password": "YOUR_PASSWORD",
    "appID": "YOUR_APP_ID",
    "appVersion": "1.0",
    "platformID": "3",
    "appAccessKey": "YOUR_ACCESS_KEY"
  }'
# Response: authToken — use this as ?authToken= in subsequent calls`,
        description:
          "MaaS360 uses an auth token appended as a query parameter (not a header). The token expires and needs to be refreshed. The `platformID: 3` indicates the API client type — use 3 for web service access.",
      },
      {
        title: "Get device inventory and enrollment status",
        code: `# List enrolled devices
curl "https://services.fiberlink.com/device-apis/devices/2.0/search?authToken=TOKEN&pageNumber=1&pageSize=25&type=details"

# Key response fields:
# maas360DeviceID, username (current user — session context for shared)
# status: Active | Inactive | Wipe Pending
# complianceState: Compliant | Non-Compliant | Managed
# lastReported (ISO timestamp — session context)`,
        description:
          "Returns device enrollment status and compliance state. For shared devices, `username` in the device record reflects the currently assigned or last-authenticated user — the session context signal for SignalGrid's identity layer.",
      },
      {
        title: "Get device compliance details",
        code: `# Get compliance details for a specific device
curl "https://services.fiberlink.com/compliance-apis/compliance/1.0/getDeviceCompliance?maas360DeviceID={id}&authToken=TOKEN"

# Response:
# complianceRules[]: { ruleName, policyType, status, severity }
# policyType: passcode, encryption, jailbreak, OS version, app compliance
# status: compliant | non-compliant | warning`,
        description:
          "Per-rule compliance breakdown with severity classifications. MaaS360's threat management layer may also return additional signals: `threatRisk: High | Medium | Low | Clean` for devices with MaaS360 Advisor threat detection enabled.",
      },
      {
        title: "Map MaaS360 compliance to SignalGrid signals",
        code: `// MaaS360 → SignalGrid signal mapping
async function getMaaS360Signals(deviceId: string) {
  const [device, compliance] = await Promise.all([
    fetch(\`\${MAAS360_URL}/device-apis/devices/2.0/search?maas360DeviceID=\${deviceId}&authToken=\${TOKEN}\`)
      .then(r => r.json()),
    fetch(\`\${MAAS360_URL}/compliance-apis/compliance/1.0/getDeviceCompliance?maas360DeviceID=\${deviceId}&authToken=\${TOKEN}\`)
      .then(r => r.json()),
  ]);

  const d = device.devices[0];
  const rules = compliance.complianceRules ?? [];
  const failedRules = rules.filter((r: any) => r.status === "non-compliant");

  return {
    devicePosture: {
      signalType: "device-posture",
      compliant: d.complianceState === "Compliant",
      failedRules: failedRules.map((r: any) => r.ruleName),
      threatRisk: d.threatRisk ?? "unknown",
      platform: "maas360",
    },
    sessionContext: {
      signalType: "session-context",
      assignedUser: d.username,
      lastReported: d.lastReported,
      deviceActive: d.status === "Active",
    },
  };
}`,
        description:
          "MaaS360's `threatRisk` field (if MaaS360 Advisor is enabled) provides a pre-computed threat score — High/Medium/Low/Clean — that SignalGrid can consume directly as a device posture signal without building its own threat evaluation logic. This is particularly valuable in regulated environments where MaaS360 is already the source of truth for device security posture.",
      },
    ],
  },

  {
    id: "ninjarmm",
    vendor: "NinjaOne",
    category: "MDM / UEM",
    product: "NinjaOne RMM",
    signalTypes: ["Device Posture"],
    status: "not-started",
    priority: "P3",
    notes:
      "Leading RMM platform for MSPs and mid-market IT teams. High Gartner willingness-to-recommend score (4.8 stars, 237 ratings). NinjaOne manages endpoints for ~40,000 customers — reaching those customers through MSP partners could be a channel strategy for SignalGrid. Device health, patch compliance, active alerts, and monitoring status available via REST API v2. 14-day free trial with full API access.",
    apiDocs: "https://app.ninjarmm.com/apidocs/",
    quickstartSteps: [
      {
        title: "Create a NinjaOne trial and OAuth application",
        code: `# 14-day trial: ninjarmm.com → Free Trial
# After setup: Administration → Apps → API → Add Application
# Client Type: Web (Authorization Code) or Machine-to-Machine
# For server-to-server: use Machine-to-Machine with client credentials`,
        description:
          "NinjaOne uses OAuth 2.0. For server-side integration (SignalGrid's use case), create a Machine-to-Machine application in the NinjaOne admin console. The app gets a client_id and client_secret for the client credentials flow.",
      },
      {
        title: "Get an OAuth access token",
        code: `# Client credentials flow for server-to-server
curl -X POST "https://app.ninjarmm.com/ws/oauth/token" \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=client_credentials&client_id=CLIENT_ID&client_secret=CLIENT_SECRET&scope=monitoring management"

# Response: { access_token, token_type: "Bearer", expires_in }`,
        description:
          "NinjaOne access tokens expire in 3600 seconds (1 hour). Implement token refresh in the SignalGrid adapter. The `monitoring` scope covers device reads; `management` scope is needed for any write operations.",
      },
      {
        title: "Get device inventory and health status",
        code: `# List all managed devices
curl -H "Authorization: Bearer TOKEN" \\
  "https://app.ninjarmm.com/v2/devices?pageSize=25"

# Get specific device
curl -H "Authorization: Bearer TOKEN" \\
  "https://app.ninjarmm.com/v2/device/{device_id}"

# Key fields: online (bool), nodeClass, os.name, os.buildNumber
# lastContact (ISO timestamp — session context)
# approval: APPROVED | PENDING | REJECTED (enrollment state)`,
        description:
          "Returns device inventory with online/offline status and OS details. `lastContact` is the device's last check-in with the NinjaOne agent — equivalent to Intune's `lastSyncDateTime` and Fleet's `seen_time`. An approved device with recent contact and no active alerts = compliant posture baseline.",
      },
      {
        title: "Get active alerts (operational signals)",
        code: `# Get all active alerts
curl -H "Authorization: Bearer TOKEN" \\
  "https://app.ninjarmm.com/v2/alerts"

# Filter by device
curl -H "Authorization: Bearer TOKEN" \\
  "https://app.ninjarmm.com/v2/device/{device_id}/activities"

# Alert fields: severity (CRITICAL|MAJOR|MINOR), message, createTime
# Severity CRITICAL or MAJOR on requesting device = operational signal`,
        description:
          "Active alerts on a specific device are NinjaOne's operational signal layer. A CRITICAL alert (disk failure, service crash, security detection) on the requesting device should elevate SignalGrid's operational signal score regardless of MDM compliance status — the device may be enrolled and 'compliant' but have an active hardware failure event.",
      },
      {
        title: "Get OS patch compliance state",
        code: `# Get pending OS patches for a device
curl -H "Authorization: Bearer TOKEN" \\
  "https://app.ninjarmm.com/v2/device/{device_id}/os-patches?status=FAILED,MANUAL"

# Patch status values: INSTALLED | FAILED | MANUAL | APPROVED | PENDING
# Count of FAILED patches = patch posture signal
# Patch severity: CRITICAL | IMPORTANT | MODERATE | LOW`,
        description:
          "Pending CRITICAL or IMPORTANT patch count is a device posture signal. A device with 5+ pending critical patches but MDM 'compliant' status (because the MDM policy only checks enrollment) illustrates the layered posture evaluation SignalGrid enables.",
      },
    ],
  },

  {
    id: "ivanti",
    vendor: "Ivanti",
    category: "MDM / UEM",
    product: "Ivanti Neurons for UEM",
    signalTypes: ["Device Posture"],
    status: "not-started",
    priority: "P3",
    notes:
      "Large enterprise UEM platform, formerly MobileIron. Strong presence in regulated industries and large-enterprise deployments alongside existing Intune or Jamf stacks. Ivanti Neurons adds AI-driven endpoint hygiene scoring on top of classic MDM compliance — the Neurons 'Intelligent Experience' score is a pre-computed posture signal SignalGrid can consume. Gartner: 536 ratings, 4.4 stars. Best reached through enterprise accounts already managing MobileIron migrations.",
    apiDocs: "https://developer.ivanti.com/",
    quickstartSteps: [
      {
        title: "Get Ivanti partner or trial access",
        code: `# Ivanti trial: ivanti.com/solutions/free-trial
# Partner portal access: ivanti.com/partners
# Ivanti Neurons Platform: admin.ivanti.com
# API credentials: Settings → API → Client Credentials`,
        description:
          "Ivanti trials are enterprise-scoped and may require sales contact. The Ivanti partner program provides developer access to sandbox tenants. The API uses OAuth 2.0 client credentials — configure a service account application in the admin portal.",
      },
      {
        title: "Authenticate with OAuth 2.0",
        code: `# Client credentials flow
curl -X POST "https://accounts.ivanti.com/oauth2/token" \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=client_credentials&client_id=CLIENT_ID&client_secret=CLIENT_SECRET"

# Or for Ivanti Neurons API:
curl -X POST "https://TENANT.ivanti.com/api/auth/token" \\
  -d "grant_type=client_credentials&client_id=ID&client_secret=SECRET"`,
        description:
          "Ivanti uses standard OAuth 2.0 client credentials. Token format and base URL may vary between Ivanti Neurons (cloud) and on-premise Ivanti UEM deployments — confirm with the tenant configuration in the admin console.",
      },
      {
        title: "Get device inventory and compliance state",
        code: `# List managed devices
curl -H "Authorization: Bearer TOKEN" \\
  "https://TENANT.ivanti.com/api/v1/devices?$top=25"

# Get device details (OData-compatible filtering)
curl -H "Authorization: Bearer TOKEN" \\
  "https://TENANT.ivanti.com/api/v1/devices?$filter=serialNumber eq 'SERIAL123'"

# Key compliance fields:
# complianceStatus: Compliant | NonCompliant | Pending | Unknown
# managementStatus: Enrolled | PartiallyEnrolled | Unenrolled
# deviceHealthScore: 0-100 (Neurons AI hygiene score)`,
        description:
          "Ivanti Neurons adds `deviceHealthScore` — an AI-computed 0-100 hygiene score that aggregates patch compliance, vulnerability density, and endpoint health signals. This is a pre-computed posture signal that SignalGrid can consume directly without building its own aggregation logic.",
      },
      {
        title: "Query Neurons endpoint hygiene score",
        code: `# Ivanti Neurons hygiene score (AI-computed)
curl -H "Authorization: Bearer TOKEN" \\
  "https://TENANT.ivanti.com/api/v1/endpointmanagement/devices/{id}/hygieneScore"

# Response:
# { overallScore: 72, riskBand: "Medium",
#   components: { patchScore: 85, vulnerabilityScore: 65, configScore: 70 } }

# Risk bands: Critical (0-25) | High (26-50) | Medium (51-75) | Low (76-100)`,
        description:
          "Ivanti's hygiene score provides a risk band (Critical / High / Medium / Low) that maps cleanly to SignalGrid's Deny / Restrict / Step-Up / Allow outcomes. A Critical device gets Deny, High gets Restrict, Medium gets Step-Up, Low gets Allow — without SignalGrid needing to build the scoring logic itself.",
      },
      {
        title: "Map Ivanti Neurons hygiene score to SignalGrid",
        code: `// Ivanti Neurons → SignalGrid device posture mapping
async function getIvantiPosture(deviceId: string) {
  const [device, hygiene] = await Promise.all([
    fetch(\`\${IVANTI_URL}/api/v1/devices/\${deviceId}\`, HEADERS).then(r => r.json()),
    fetch(\`\${IVANTI_URL}/api/v1/endpointmanagement/devices/\${deviceId}/hygieneScore\`, HEADERS)
      .then(r => r.json()),
  ]);

  // Direct risk band → outcome mapping
  const riskOutcomeMap: Record<string, string> = {
    Critical: "deny",
    High: "restrict",
    Medium: "step-up",
    Low: "allow",
  };

  return {
    signalType: "device-posture",
    platform: "ivanti-neurons",
    compliant: device.complianceStatus === "Compliant",
    hygieneScore: hygiene.overallScore,
    riskBand: hygiene.riskBand,
    recommendedOutcome: riskOutcomeMap[hygiene.riskBand] ?? "step-up",
    components: hygiene.components,
  };
}`,
        description:
          "Ivanti's pre-computed risk band maps directly to SignalGrid outcomes — the cleanest outcome-mapping of any MDM platform in this list. Critical→Deny, High→Restrict, Medium→Step-Up, Low→Allow requires zero additional computation from SignalGrid's policy engine.",
      },
    ],
  },

  {
    id: "manage-engine",
    vendor: "ManageEngine",
    category: "MDM / UEM",
    product: "ManageEngine Endpoint Central",
    signalTypes: ["Device Posture"],
    status: "not-started",
    priority: "P3",
    notes:
      "Popular mid-market UEM with strong traction in SMB and mid-market IT environments, particularly in healthcare and manufacturing. Unified platform covering patch management, software deployment, remote control, and mobile device management in a single console. REST API available for device inventory, patch compliance, and vulnerability status. Gartner: 533 ratings, 4.6 stars — Customers Choice 2025.",
    apiDocs: "https://www.manageengine.com/products/desktop-central/api/",
    quickstartSteps: [
      {
        title: "Set up ManageEngine Endpoint Central (on-premise or cloud)",
        code: `# Cloud: manageengine.com/products/endpoint-central → Free Trial (30 days)
# On-premise: download at manageengine.com → install on Windows Server
# API access: Admin → API Settings → Enable API → Generate API Key
# Base URL (cloud): https://endpointcentral.manageengine.com/api
# Base URL (on-prem): https://HOSTNAME:8020/api`,
        description:
          "ManageEngine Endpoint Central is available as cloud SaaS or on-premise. The free trial includes 25 endpoints — sufficient for sandbox integration testing. API access must be explicitly enabled in Admin settings, and an API key generated per user account.",
      },
      {
        title: "Authenticate — API key header",
        code: `# ManageEngine uses API key in Authorization header
curl -H "Authorization: Zoho-oauthtoken YOUR_API_KEY" \\
  "https://endpointcentral.manageengine.com/api/1.4/desktop/computers/computerdetails?compid=1"

# Alternative: OAuth 2.0 (Zoho accounts)
curl -X POST "https://accounts.zoho.com/oauth/v2/token" \\
  -d "grant_type=client_credentials&client_id=ID&client_secret=SECRET&scope=MDMCenter.EndpointCentral"`,
        description:
          "ManageEngine uses Zoho OAuth infrastructure (ManageEngine is a Zoho product). For server-to-server integration, use client credentials OAuth with the MDMCenter.EndpointCentral scope. The direct API key option is simpler for sandbox testing.",
      },
      {
        title: "Get computer inventory and patch status",
        code: `# Get all managed computers with health status
curl -H "Authorization: Zoho-oauthtoken TOKEN" \\
  "https://endpointcentral.manageengine.com/api/1.4/patch/allsystems"

# Key fields:
# systemstatus: Live | Offline
# patchscanstatus: Scanned | Not Scanned | Scan Failed
# missingPatches: count of missing patches
# lastpatchscan: timestamp
# servicepacklevel: current OS service pack`,
        description:
          "Returns patch scan status and missing patch count for all managed systems. `missingPatches > 0` with `systemstatus = Live` is a device posture signal — the device is online and has known patch gaps. Missing patch count maps to posture severity (0=compliant, 1-5=minor gap, >10=critical gap).",
      },
      {
        title: "Get vulnerability status (CVE exposure)",
        code: `# Get vulnerability scan results
curl -H "Authorization: Zoho-oauthtoken TOKEN" \\
  "https://endpointcentral.manageengine.com/api/1.4/patch/vulnerabilities?compid={computer_id}"

# Response:
# { vulnerabilities: [ { cveId, severity, patchStatus, cvssScore } ] }
# severity: Critical | High | Medium | Low
# Filter for Critical/High unpatched CVEs as posture signal`,
        description:
          "ManageEngine Endpoint Central includes vulnerability management — matching installed software against CVE databases. Devices with unpatched Critical-severity CVEs are a stronger posture signal than patch count alone. A device with a CVSS 9.0+ unpatched CVE in its software inventory should produce a Restrict or Deny outcome.",
      },
      {
        title: "Map ManageEngine posture data to SignalGrid",
        code: `// ManageEngine → SignalGrid device posture mapping
async function getManageEnginePosture(computerId: string) {
  const [computer, vulns] = await Promise.all([
    fetch(\`\${ME_URL}/api/1.4/patch/allsystems?compid=\${computerId}\`, HEADERS).then(r => r.json()),
    fetch(\`\${ME_URL}/api/1.4/patch/vulnerabilities?compid=\${computerId}\`, HEADERS).then(r => r.json()),
  ]);

  const comp = computer.systems?.[0];
  const criticalVulns = vulns.vulnerabilities?.filter(
    (v: any) => v.severity === "Critical" && v.patchStatus !== "Installed"
  ) ?? [];

  const patchScore = comp?.missingPatches > 10 ? "critical"
    : comp?.missingPatches > 3 ? "degraded"
    : comp?.missingPatches > 0 ? "minor"
    : "compliant";

  return {
    signalType: "device-posture",
    platform: "manage-engine",
    online: comp?.systemstatus === "Live",
    patchScore,
    missingPatches: comp?.missingPatches ?? 0,
    criticalVulnCount: criticalVulns.length,
    hasCriticalCVE: criticalVulns.length > 0,
    lastPatchScan: comp?.lastpatchscan,
  };
}`,
        description:
          "ManageEngine provides two independent posture signals: patch compliance (missingPatches count) and vulnerability exposure (unpatched CVEs). The combination — a device with 12 missing patches and 2 critical unpatched CVEs — produces a stronger posture signal than either metric alone, enabling nuanced SignalGrid policy rules.",
      },
    ],
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
