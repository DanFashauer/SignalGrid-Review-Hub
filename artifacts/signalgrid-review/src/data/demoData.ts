export interface DemoStep {
  id: string;
  phase: "setup" | "trigger" | "evaluation" | "outcome";
  phaseLabel: string;
  title: string;
  narrative: string;
  technicalNote?: string;
  duration: string;
}

export interface DemoScenario {
  id: string;
  title: string;
  industry: string;
  platform: string;
  platformId: string;
  environment: string;
  totalDuration: string;
  prerequisite: string;
  openingFrame: string;
  steps: DemoStep[];
}

export const demoScenarios: DemoScenario[] = [
  {
    id: "healthcare-intune",
    title: "Frontline Shift-Change Access Decision",
    industry: "Healthcare",
    platform: "Microsoft Intune + Entra ID",
    platformId: "intune-entra",
    environment: "400-bed regional hospital, shared iOS medication cart devices, Intune + Entra ID deployment",
    totalDuration: "10–12 minutes",
    prerequisite:
      "rc:smoke passing. Demo environment connected to Intune sandbox tenant. Two test user identities: Nurse A (on-shift, compliant device) and Nurse B (off-shift, device with open compliance incident).",
    openingFrame:
      "You manage 200 nurses across three shifts. They share 40 medication cart iPads. Your existing Conditional Access policy was written for knowledge workers with persistent devices. This morning, a nurse from the previous shift left a device in a non-compliant state, another nurse started their shift and picked it up, and a third device has an open Intune incident from last week. Your EHR workflow doesn't know any of this. SignalGrid does.",
    steps: [
      {
        id: "d1-1",
        phase: "setup",
        phaseLabel: "Environment Setup",
        title: "Show the baseline — what the existing stack sees",
        narrative:
          "Open the Entra ID tenant. Show that all three devices are 'enrolled' and 'compliant' from the perspective of the MDM enrollment record. Open the Conditional Access policy — it's configured for compliant device + MFA = allow. From Conditional Access's point of view, access would be granted to all three devices for any authenticated user.",
        technicalNote:
          "This is the 'why existing tools don't solve this' moment. Let the audience see that the existing stack gives a clean bill of health before you show what SignalGrid sees.",
        duration: "2 min",
      },
      {
        id: "d1-2",
        phase: "trigger",
        phaseLabel: "Decision Trigger",
        title: "Nurse B authenticates on a device with an open incident",
        narrative:
          "Authenticate as Nurse B on Device 2. Nurse B's identity is valid — MFA passed, Entra ID token issued. Now trigger a workflow access request: access to the EHR medication administration module. Without SignalGrid, Conditional Access evaluates: compliant device + valid identity = allow. The workflow opens. But SignalGrid is in the path. Show the SignalGrid decision console receiving the request.",
        technicalNote:
          "Decision console should show all four signal inputs populating in real time: identity (valid), device posture (non-compliant — Intune compliance incident), session context (shift started 2 minutes ago — within window), operational signals (open incident #INC0023417 for Device 2).",
        duration: "2–3 min",
      },
      {
        id: "d1-3",
        phase: "evaluation",
        phaseLabel: "Signal Evaluation",
        title: "SignalGrid evaluates the four-signal combination",
        narrative:
          "Walk through each signal input in the console. Identity: valid. Device posture: non-compliant — Intune marks Device 2 as having a hardware health incident. Session context: within shift window, role matches assignment, no anomalous location. Operational signals: open ServiceNow incident #INC0023417 for Device 2, filed 6 days ago, hardware category, unresolved. The policy rule: any open ITSM incident of type 'hardware' on the requesting device → route to Restrict outcome, not Allow.",
        technicalNote:
          "This is the product moment. Four signals evaluated simultaneously. Two of them would pass any existing tool's check. Two of them — device posture + operational signal — produce a Restrict decision. Show how the rule is configured so the audience understands this is policy-driven, not a black box.",
        duration: "3 min",
      },
      {
        id: "d1-4",
        phase: "outcome",
        phaseLabel: "Access Outcome",
        title: "Restricted access — workflow continues with guardrails",
        narrative:
          "The decision outcome is Restrict, not Deny. Nurse B gets access to read-only patient records but the medication administration write workflow is blocked pending device remediation. A notification is sent to the charge nurse and the device queue. The incident ticket is updated with a note that access was restricted due to open incident state. Nurse B can continue working — just not on medication administration until the device is cleared.",
        technicalNote:
          "Emphasize: this is not a hard block. It's a calibrated outcome. Nurse B can still do most of their work. The high-risk workflow is protected. The charge nurse is notified. The incident is now linked to an access event — which creates an audit trail that didn't exist before.",
        duration: "2 min",
      },
      {
        id: "d1-5",
        phase: "outcome",
        phaseLabel: "Closing Frame",
        title: "What just happened — and why your existing stack couldn't do it",
        narrative:
          "Conditional Access saw: compliant device, valid identity. It would have allowed full EHR access. SignalGrid saw: non-compliant posture, open incident, valid identity, normal session context. It calibrated the outcome. The difference isn't that SignalGrid replaced Conditional Access — it used Intune and Entra data that Conditional Access already had, added the ServiceNow signal it didn't, and made a decision at workflow execution time instead of login time. That's the runtime decision layer.",
        technicalNote:
          "Leave audience with the phrase 'workflow execution time, not login time.' That's the positioning sentence that distinguishes SignalGrid from every adjacent tool.",
        duration: "1–2 min",
      },
    ],
  },

  {
    id: "healthcare-fleet",
    title: "Fleet osquery Policy — Shift-Change Enforcement",
    industry: "Healthcare",
    platform: "Fleet MDM + osquery",
    platformId: "fleet",
    environment: "300-bed community hospital, nursing station iPads managed via Fleet MDM, osquery disk encryption and MDM profile policies active",
    totalDuration: "8–10 minutes",
    prerequisite:
      "fleetctl preview running locally with two enrolled test hosts. Fleet policy: disk_encryption (encrypted=0 = fail). Two test devices: Device A (encryption enabled, policy passing) and Device B (encryption disabled, policy failing).",
    openingFrame:
      "Your hospital just deployed Fleet MDM to manage shared nursing station iPads. Fleet gives you real-time visibility through osquery — you can write SQL-like policies against any device attribute. The problem is that a passing MDM enrollment record doesn't mean the device is actually secure. Device B is enrolled. Its management profile is valid. But the disk is unencrypted. Your EHR workflow can't see that. SignalGrid can.",
    steps: [
      {
        id: "d2-1",
        phase: "setup",
        phaseLabel: "Fleet Policy Setup",
        title: "Show the Fleet policy dashboard — what passes and fails",
        narrative:
          "Open the Fleet console (localhost:1337 in the preview environment). Navigate to Policies. Show the 'Disk Encryption Enabled' policy — a single osquery query: SELECT encrypted FROM disk_encryption WHERE encrypted = 0. Device A: no results returned → policy passes. Device B: returns one row → policy fails. Both devices show as enrolled and managed in the Fleet hosts view. The distinction between 'enrolled' and 'policy compliant' is visible here but invisible to Conditional Access.",
        technicalNote:
          "The osquery policy model is Fleet's core differentiator. Any SQL-queryable device attribute becomes a compliance check. Show the policy query editor — write a new policy live if the audience asks. It takes 30 seconds to define a new device posture check.",
        duration: "2 min",
      },
      {
        id: "d2-2",
        phase: "trigger",
        phaseLabel: "Decision Trigger",
        title: "Nurse authenticates on Device B — Fleet policy failure in scope",
        narrative:
          "Authenticate as Nurse Rodriguez on Device B. Identity check passes — MFA completed, session token issued. Trigger a workflow access request for the controlled substances administration log. SignalGrid receives the request and queries the Fleet REST API: GET /api/v1/fleet/hosts/{device_b_id}/policy_compliance. Fleet returns: disk_encryption policy = failing for this host. This is the device posture signal.",
        technicalNote:
          "Show the actual Fleet API call in the SignalGrid decision trace: GET /api/v1/fleet/hosts/{id}/policy_compliance returns { policies: [ { id: 1, name: 'Disk Encryption', response: 'fail' } ] }. The fail is the posture signal.",
        duration: "2 min",
      },
      {
        id: "d2-3",
        phase: "evaluation",
        phaseLabel: "Signal Evaluation",
        title: "Four-signal evaluation with Fleet as device posture source",
        narrative:
          "Identity: valid (Entra ID, MFA completed). Device posture: failing — Fleet disk_encryption policy returns encrypted=0. Session context: within shift window, location normal. Operational signals: no open ITSM incidents for this device. The policy rule: Fleet disk_encryption policy failure on any device accessing the controlled substances log → Deny. This is a compliance-critical workflow where an unencrypted device is a regulatory risk (HIPAA § 164.312(a)(2)(iv)).",
        technicalNote:
          "The regulatory context matters. Mention HIPAA only to explain why the policy severity is higher for this specific workflow. Don't imply SignalGrid provides HIPAA compliance — it provides the enforcement mechanism for a policy that the hospital's compliance team writes.",
        duration: "2–3 min",
      },
      {
        id: "d2-4",
        phase: "outcome",
        phaseLabel: "Access Outcome",
        title: "Deny with automated remediation queue — Fleet auto-fix triggered",
        narrative:
          "The decision outcome is Deny for the controlled substances log. Nurse Rodriguez is redirected to a compliance notification page: 'Device encryption check failed. Contact IT for device remediation.' Simultaneously, SignalGrid triggers a Fleet webhook: the device is added to a Fleet auto-remediation target list. The IT queue receives a device remediation task. Nurse Rodriguez can use any other compliant device to access the workflow — the block is device-specific, not user-specific.",
        technicalNote:
          "Fleet supports policy automation — when a policy fails, Fleet can trigger a script or webhook. The integration loop is: Fleet detects failure → SignalGrid enforces access restriction → Fleet queues remediation → SignalGrid re-evaluates on next access request. Show this full loop if time allows.",
        duration: "2 min",
      },
      {
        id: "d2-5",
        phase: "outcome",
        phaseLabel: "Closing Frame",
        title: "Open source + Zero Trust — the Fleet integration argument",
        narrative:
          "Fleet is free and open source. Its sandbox is running locally right now on a single command: fleetctl preview. The entire integration — Fleet policy API to SignalGrid device posture signal — took less than two hours to build. If your hospital is evaluating MDM platforms or wants to pilot Zero Trust enforcement without a six-month enterprise contract, Fleet is the fastest path to a working proof of concept.",
        technicalNote:
          "This closing frame works for technical audiences and for budget-constrained healthcare IT buyers. The 'two hours to working PoC' claim needs to stay honest — it assumes a developer who is familiar with REST APIs and has read the Fleet quickstart documentation.",
        duration: "1 min",
      },
    ],
  },

  {
    id: "logistics-workspace-one",
    title: "Warehouse Shared-Scanner Kiosk Enforcement",
    industry: "Logistics / Distribution",
    platform: "Workspace ONE UEM (Omnissa)",
    platformId: "workspace-one",
    environment: "Regional distribution center, 150 shared Android barcode scanners in Dedicated Device mode, Workspace ONE UEM, SAP WM integration",
    totalDuration: "10–12 minutes",
    prerequisite:
      "Workspace ONE sandbox tenant with two enrolled Android Dedicated Devices. Device A: fully compliant, checked out by current worker. Device B: ComplianceStatus=NonCompliant (pending OS patch), last checked out by previous shift worker. SAP WM sandbox or mockup for the high-value inventory adjustment workflow.",
    openingFrame:
      "You run a distribution center with 150 shared barcode scanners. Every scanner is Workspace ONE enrolled. Every scanner shows up as 'managed' in your MDM console. But this morning, three scanners are running a non-compliant OS build — an update pushed last week failed silently on those devices. One of them is about to be used to authorize a $240,000 pallet movement. Your warehouse management system has no idea the scanner is non-compliant. SignalGrid does.",
    steps: [
      {
        id: "d3-1",
        phase: "setup",
        phaseLabel: "Workspace ONE Compliance View",
        title: "Show the Workspace ONE device fleet — two different compliance states",
        narrative:
          "Open the Workspace ONE console. Navigate to Devices → List View. Show that Device A and Device B are both enrolled, both assigned to Android Enterprise Dedicated Device profiles, both showing as 'Managed'. Filter by ComplianceStatus. Device A: Compliant. Device B: NonCompliant — reason: OS version below minimum required by policy. A warehouse supervisor looking at the MDM dashboard sees two identical icons. The compliance difference is one click away but not visible at a glance.",
        technicalNote:
          "Workspace ONE's Dedicated Device mode is the Android equivalent of iOS Supervised mode — full MDM lockdown, kiosk-style single-app or workflow-specific access. The compliance state for these devices is managed by OS version policies, not user authentication policies.",
        duration: "2 min",
      },
      {
        id: "d3-2",
        phase: "trigger",
        phaseLabel: "Decision Trigger",
        title: "Worker picks up Device B at shift start — workflow access requested",
        narrative:
          "Worker Jordan checks in at the start of their shift and picks up Device B from the charging rack. Jordan scans their badge — session context signal: Jordan is on the day shift schedule, this is expected access time. Jordan authenticates via the Workspace ONE Hub app — identity signal: valid. Jordan attempts to access the high-value inventory adjustment workflow in SAP WM. SignalGrid receives the request. It queries Workspace ONE: GET /api/v1/mdm/devices?searchby=Serialnumber&id=DEVICE_B_SERIAL.",
        technicalNote:
          "The Workspace ONE API call returns: ComplianceStatus=NonCompliant, reason=OsVersionRequirement, LastSeen=today. SignalGrid has all four signals: identity (valid), device posture (NonCompliant), session context (within shift window, normal location), operational signals (no open incidents).",
        duration: "2 min",
      },
      {
        id: "d3-3",
        phase: "evaluation",
        phaseLabel: "Signal Evaluation",
        title: "Device posture failure on high-value workflow — signal evaluation",
        narrative:
          "Identity: valid (badge + Workspace ONE Hub auth). Device posture: NonCompliant — OS version below minimum policy. Session context: normal — Jordan's shift, correct location, reasonable time. Operational signals: no active ServiceNow incidents for Device B. The policy rule for the high-value inventory adjustment workflow: ComplianceStatus=NonCompliant → Step-Up verification required. Reason: an OS version gap on a scanner used for high-value pallet authorization creates a software integrity risk — the scanner firmware may have unpatched vulnerabilities.",
        technicalNote:
          "Use the term 'software integrity risk' rather than 'security vulnerability' when talking to logistics buyers. The concern isn't usually the name of a CVE — it's whether the scanner's firmware can be trusted to produce accurate scan data for a high-value inventory event.",
        duration: "2–3 min",
      },
      {
        id: "d3-4",
        phase: "outcome",
        phaseLabel: "Access Outcome",
        title: "Step-up required — supervisor confirmation before high-value action",
        narrative:
          "The decision outcome is Step-Up, not Deny. Jordan can use Device B for standard barcode scanning workflows — pick list scanning, receiving confirmation. But the high-value inventory adjustment workflow (pallet movement > $10,000) requires supervisor confirmation. Jordan's scanner displays a prompt: 'Supervisor approval required for this workflow — device pending OS update.' Jordan's shift supervisor receives a push notification and can approve from their compliant device. The high-value authorization requires two parties, not one, on a non-compliant device.",
        technicalNote:
          "The two-party approval requirement is a practical outcome that logistics buyers immediately recognize. It mirrors the separation-of-duties controls they already use for high-value transactions — SignalGrid is extending that control to the device compliance dimension.",
        duration: "2 min",
      },
      {
        id: "d3-5",
        phase: "outcome",
        phaseLabel: "Closing Frame",
        title: "Workspace ONE + SignalGrid — the shared Android fleet argument",
        narrative:
          "Workspace ONE already knows Device B is non-compliant. It sent an alert to the MDM dashboard. But the warehouse management system that runs on Device B has no channel to receive that signal. Conditional Access doesn't fire on barcode scans — there's no authentication event mid-session. SignalGrid sits at the workflow layer, queries Workspace ONE's compliance API at execution time, and routes the outcome. The MDM platform becomes a signal source for every workflow decision, not just device enrollment.",
        technicalNote:
          "Workspace ONE's Dedicated Device mode + Android Enterprise is the dominant pattern for warehouse/logistics shared scanners. This demo scenario directly addresses the #1 use case for Workspace ONE customers in logistics.",
        duration: "1–2 min",
      },
    ],
  },

  {
    id: "retail-hexnode",
    title: "POS Kiosk Mode Exit — Retail Anomaly Detection",
    industry: "Retail",
    platform: "Hexnode UEM",
    platformId: "hexnode",
    environment: "50-store retail chain, shared Android point-of-sale terminals in multi-app kiosk mode, Hexnode UEM, inventory management and POS application",
    totalDuration: "8–10 minutes",
    prerequisite:
      "Hexnode trial tenant with two enrolled Android devices. Device A: kiosk_status=kiosk_on, compliance_status=compliant. Device B: kiosk_status=kiosk_off (unexpectedly exited kiosk mode), compliance_status=compliant. Retail POS workflow mockup.",
    openingFrame:
      "You have 50 stores and 300 shared Android POS terminals. Every terminal is locked in Hexnode's multi-app kiosk mode — employees see only the POS app, the inventory app, and a few approved utilities. But this morning, five terminals across three stores have exited kiosk mode. The devices show as 'enrolled' and 'compliant' in Hexnode. Enrollment is fine. Kiosk lockdown is gone. Your POS application has no idea the device it's running on just became a general-purpose Android phone. SignalGrid does.",
    steps: [
      {
        id: "d4-1",
        phase: "setup",
        phaseLabel: "Hexnode Kiosk Status View",
        title: "Show the Hexnode device list — enrolled but kiosk_off",
        narrative:
          "Open the Hexnode console. Navigate to Devices. Show Device A and Device B side by side. Both are enrolled. Both show compliance_status=compliant — the compliance policy covers encryption and OS version, both of which pass. Now show the kiosk status column. Device A: kiosk mode active. Device B: kiosk mode disabled. In Hexnode, this distinction is visible if you know to look for it. In your POS application, it's invisible. A cashier using Device B has a full Android home screen behind the POS app — they can install apps, access the browser, sideload APKs.",
        technicalNote:
          "Hexnode's `kiosk_status` field in the API is the unique signal here. Most MDMs don't expose kiosk mode state as a distinct API field at this granularity. This is the Hexnode-specific integration story.",
        duration: "2 min",
      },
      {
        id: "d4-2",
        phase: "trigger",
        phaseLabel: "Decision Trigger",
        title: "Store associate attempts high-value inventory write on Device B",
        narrative:
          "Store associate Sam picks up Device B from the register. Kiosk mode is off — Sam doesn't notice, the POS app is still the foreground app. Sam authenticates using the store associate credentials. Identity check: valid. Sam attempts to execute a high-value inventory adjustment — a markdown event on 50 units of merchandise worth $4,500. SignalGrid receives the workflow execution request. It queries the Hexnode API: GET /api/v1/device/{device_b_id}/ and reads kiosk_status=kiosk_off.",
        technicalNote:
          "The Hexnode API call is the key moment. `kiosk_status: 'kiosk_off'` on a device that should be in kiosk lockdown is an operational anomaly — not an MDM compliance failure (the device is still compliant by MDM policy standards), but a control environment anomaly.",
        duration: "2 min",
      },
      {
        id: "d4-3",
        phase: "evaluation",
        phaseLabel: "Signal Evaluation",
        title: "Kiosk mode exit — operational anomaly triggers Restrict",
        narrative:
          "Identity: valid (store associate credentials, within assigned shift). Device posture: compliant (encryption, OS version pass). Session context: normal shift hours, store location. Operational signals: kiosk_status=kiosk_off on a device classified as a kiosk terminal → operational anomaly. The policy rule: any kiosk-designated device with kiosk_status=kiosk_off attempting a high-value inventory write → Restrict. Reason: kiosk mode exit on a shared POS terminal indicates the device control boundary has been broken — the integrity of the access context cannot be confirmed.",
        technicalNote:
          "The 'integrity of the access context' framing is important for retail buyers. They understand that a device that has exited kiosk mode may have had unauthorized apps installed, browser-based session hijacking, or other tampering. SignalGrid isn't claiming any of these happened — it's noting that the control boundary is broken.",
        duration: "2–3 min",
      },
      {
        id: "d4-4",
        phase: "outcome",
        phaseLabel: "Access Outcome",
        title: "Inventory write blocked — IT alert raised, manager override required",
        narrative:
          "The decision outcome is Restrict. Sam can process standard POS transactions — cash, card, returns. The high-value inventory adjustment workflow is blocked. Sam's screen displays: 'Inventory adjustment restricted on this device — contact your store manager.' The store manager receives a push alert: 'POS device kiosk mode violation — Device B, Store 14.' IT receives an automated Hexnode remediation task: re-apply the kiosk profile to Device B. The incident is logged with the device ID, the attempted workflow, Sam's identity, and the kiosk_status signal that triggered the restriction.",
        technicalNote:
          "The automated Hexnode remediation task is a real capability — Hexnode supports policy enforcement automation that can re-apply kiosk mode profiles remotely. The integration loop: Hexnode detects kiosk exit → SignalGrid restricts high-value workflows → Hexnode re-applies kiosk profile → SignalGrid re-evaluates on next request.",
        duration: "2 min",
      },
      {
        id: "d4-5",
        phase: "outcome",
        phaseLabel: "Closing Frame",
        title: "Hexnode kiosk_status — the invisible control boundary signal",
        narrative:
          "Every existing access control tool in your retail environment — authentication, MDM compliance, network access — would have allowed this transaction. Sam's identity was valid. The device was enrolled. The compliance policy passed. SignalGrid added one signal: is this device actually operating in the control environment it's supposed to operate in? The kiosk_status field is a 30-millisecond API call. The access decision it enabled prevented a high-value inventory write on a device with a broken control boundary.",
        technicalNote:
          "Leave the audience with the kiosk_status concept. It's the retail-specific answer to 'what can SignalGrid tell me that my existing tools can't?' — a device that's enrolled and compliant but no longer in the control context it was enrolled for.",
        duration: "1 min",
      },
    ],
  },

  {
    id: "enterprise-tanium",
    title: "Real-Time Process Anomaly — Privileged Tool Access",
    industry: "Enterprise IT / Technology",
    platform: "Tanium Autonomous IT Platform",
    platformId: "tanium",
    environment: "5,000-endpoint enterprise tech company, Tanium-managed Windows fleet, privileged configuration management tooling, engineering teams with shared build/lab environments",
    totalDuration: "10–12 minutes",
    prerequisite:
      "Tanium sandbox or trial environment with two enrolled endpoints. Endpoint A: all required security agents running, no anomalous processes. Endpoint B: required security agent not in running process list (simulated agent crash or tampering). Privileged tool access mockup.",
    openingFrame:
      "Your engineering team uses shared build lab machines. 50 Windows servers, managed by Tanium, accessed by rotating engineers. Your privileged configuration management tool requires that every requesting endpoint is running your approved security agent. Most of the time it is. But Tanium can ask your endpoints — right now, in real time — whether the agent is actually running. Endpoint B's agent crashed 3 hours ago. Nothing flagged it. It's still showing as 'compliant' in your MDM. A senior engineer is about to use it to push a configuration change to production. SignalGrid knows about the agent crash. The config management tool doesn't.",
    steps: [
      {
        id: "d5-1",
        phase: "setup",
        phaseLabel: "Tanium Real-Time Visibility",
        title: "Ask Tanium — is the required security agent running right now?",
        narrative:
          "Open the Tanium console. Navigate to Interact. Ask a Tanium Question: 'Get Running Services containing \"CrowdStrike\" from computers where Computer Name = \"ENDPOINT-B\"'. Results return in under 15 seconds. Endpoint A: CrowdStrike Falcon Sensor is running. Endpoint B: no results — the service is not running. Compare this to the MDM console, which shows both devices as enrolled and compliant. MDM compliance is evaluated at scan time. Tanium is evaluated right now.",
        technicalNote:
          "The Tanium Question model is the key differentiator to demonstrate. Write the question live — it takes 10 seconds to type and 15 seconds to return results. The real-time aspect is the product moment: 'your MDM told you it was compliant yesterday. Tanium is telling you what's true right now.'",
        duration: "2–3 min",
      },
      {
        id: "d5-2",
        phase: "trigger",
        phaseLabel: "Decision Trigger",
        title: "Engineer requests access to privileged config management tooling",
        narrative:
          "Senior Engineer Alex requests access to the Terraform Cloud configuration management tool to push a change to the production load balancer configuration. Alex's identity is valid — MFA completed, Okta session active, role = 'Senior Infrastructure Engineer'. Alex's endpoint: ENDPOINT-B. SignalGrid receives the privilege escalation request. It queries the Tanium API: POST /api/v2/questions with query text 'Get Running Services containing \"CrowdStrike\" from computers where Computer Name contains \"ENDPOINT-B\"'. Tanium responds in 12 seconds.",
        technicalNote:
          "The 12-second Tanium query is within an acceptable real-time evaluation window for a privilege escalation decision. Show the actual API call and response time in the decision trace — the latency is a real consideration and being transparent about it is credible.",
        duration: "2 min",
      },
      {
        id: "d5-3",
        phase: "evaluation",
        phaseLabel: "Signal Evaluation",
        title: "Security agent absent — operational anomaly on privileged endpoint",
        narrative:
          "Identity: valid (Alex's credentials, MFA, correct role). Device posture: MDM-compliant (last scan 6 hours ago — agent was running then). Session context: normal work hours, corporate network. Operational signals: Tanium real-time query returns zero results for CrowdStrike Falcon on ENDPOINT-B. The required security agent is not running. This is an operational anomaly — the endpoint's control boundary is broken. The policy rule: required security agent absent on endpoint requesting privilege escalation → Deny. A production infrastructure change pushed from an unprotected endpoint is an unacceptable security risk.",
        technicalNote:
          "The MDM compliance vs. Tanium real-time distinction is the evaluation moment. MDM said compliant 6 hours ago. Tanium says the agent is not running right now. The 6-hour delta is the gap — and it's the gap that every enterprise with MDM + no real-time posture evaluation has. Tanium closes it.",
        duration: "3 min",
      },
      {
        id: "d5-4",
        phase: "outcome",
        phaseLabel: "Access Outcome",
        title: "Privilege escalation denied — Tanium investigation queued",
        narrative:
          "The decision outcome is Deny. Alex's Terraform Cloud access request is rejected. The decision log shows: 'Privilege escalation denied — required security agent not detected on requesting endpoint (Tanium real-time query, evaluated at 14:23:07 UTC).' Alex's IT security team receives an alert: endpoint ENDPOINT-B — CrowdStrike agent not running, privilege escalation attempted. Tanium receives a webhook: endpoint ENDPOINT-B added to real-time investigation queue. Alex is instructed to use a compliant workstation or contact IT to remediate ENDPOINT-B.",
        technicalNote:
          "The precise timestamp in the denial log ('evaluated at 14:23:07 UTC') is important for enterprise security buyers. It creates an immutable audit record: we knew the agent wasn't running at this exact moment, and access was denied at this exact moment. That's the audit trail that security teams need.",
        duration: "2 min",
      },
      {
        id: "d5-5",
        phase: "outcome",
        phaseLabel: "Closing Frame",
        title: "Real-time vs. scan-time — the Tanium operational signal argument",
        narrative:
          "Every IAM tool in your environment evaluated Alex's identity and found it valid. Your MDM evaluated the endpoint 6 hours ago and found it compliant. Tanium evaluated the endpoint 12 seconds ago and found the security agent missing. SignalGrid consumed Tanium's real-time answer — not the cached MDM scan — and made the access decision at the moment of the request. That's the difference between scan-time compliance and real-time posture. For privileged operations, real-time posture is the only posture that matters.",
        technicalNote:
          "The closing frame resonates most with enterprise security engineers and CISOs who've experienced a breach or near-miss caused by an agent that 'should have been running.' Don't invent specifics — let them connect it to their own experience.",
        duration: "1–2 min",
      },
    ],
  },

  {
    id: "financial-maas360",
    title: "Shared Tablet — Branch Banking Compliance Window",
    industry: "Financial Services",
    platform: "IBM Security MaaS360",
    platformId: "maas360",
    environment: "Regional bank with 80 branches, shared iPad tablets for banking advisors, IBM Security MaaS360 managing the device fleet, core banking and loan origination workflows",
    totalDuration: "10–12 minutes",
    prerequisite:
      "MaaS360 trial tenant with two enrolled iPad devices. Device A: complianceState=Compliant, threatRisk=Clean, within banking hours. Device B: complianceState=Non-Compliant (encryption exception), threatRisk=Medium (MaaS360 Advisor flagged), access attempted outside banking hours.",
    openingFrame:
      "You manage 80 bank branches and 400 shared advisor tablets. Every tablet runs IBM MaaS360 with the full threat management stack. This afternoon, a banking advisor in Branch 14 is trying to originate a mortgage loan after the branch has officially closed. The device is enrolled. MaaS360 has flagged this device's threat score as Medium — it detected unusual outbound traffic in the last hour. The loan origination system treats every authenticated advisor with an enrolled device as equivalent. Your compliance team's concern is that a high-value transaction from a suspicious device outside operating hours has no visibility layer. SignalGrid adds one.",
    steps: [
      {
        id: "d6-1",
        phase: "setup",
        phaseLabel: "MaaS360 Threat and Compliance View",
        title: "Show MaaS360 threat scores and compliance exceptions",
        narrative:
          "Open the MaaS360 portal. Navigate to Security → Threat Management. Show the device fleet threat dashboard. Device A: threatRisk=Clean, all compliance rules passing. Device B: threatRisk=Medium — MaaS360 Advisor detected unusual outbound connection patterns in the last 3 hours. Navigate to Compliance. Device B also has a compliance exception: data encryption — the exception was approved by IT 4 weeks ago for a compatibility reason and never revoked. Show the exception record — it's documented but forgotten.",
        technicalNote:
          "MaaS360's Advisor threat scoring is the unique signal here. It provides a pre-computed risk level — Clean / Low / Medium / High / Critical — that aggregates behavioral signals. Medium doesn't mean a breach has occurred; it means anomalous behavior has been detected. That's exactly the kind of signal that should inform a high-value transaction decision.",
        duration: "2–3 min",
      },
      {
        id: "d6-2",
        phase: "trigger",
        phaseLabel: "Decision Trigger",
        title: "Advisor attempts loan origination after branch close on flagged device",
        narrative:
          "Banking Advisor Morgan is in Branch 14 finishing up a client meeting. It's 6:22 PM — the branch closed at 6:00 PM. Morgan's client wants to submit a mortgage application tonight. Morgan authenticates on Device B using the bank's Okta SSO. Identity: valid. Morgan navigates to the loan origination workflow and initiates a new application for a $380,000 mortgage. SignalGrid receives the workflow execution request. It queries MaaS360: GET /api/device/1.0/getDeviceCompliance, and reads complianceState=Non-Compliant, threatRisk=Medium.",
        technicalNote:
          "Two independent signals: a compliance exception that's been active for 4 weeks (device posture) and a Medium threat score from the last 3 hours (operational signal). Either one alone might be acceptable. Together, combined with the after-hours session context, they produce a different picture.",
        duration: "2 min",
      },
      {
        id: "d6-3",
        phase: "evaluation",
        phaseLabel: "Signal Evaluation",
        title: "Three-signal combination — posture + operational + session anomaly",
        narrative:
          "Identity: valid (Morgan's credentials, MFA, banking advisor role). Device posture: non-compliant — encryption exception active, compliance exception record is 28 days old. Session context: anomalous — access attempted at 6:22 PM, 22 minutes after branch close, outside the branch's normal operating window for high-value transactions. Operational signals: MaaS360 threatRisk=Medium (unusual outbound traffic pattern detected in last 3 hours). Policy rule: non-compliant device + Medium threat score + outside operating window → Restrict. Any single signal might produce Step-Up. Three anomalous signals in combination produce Restrict.",
        technicalNote:
          "The three-signal combination is the product demonstration here. Emphasize that no single signal would necessarily block access — the combination does. This illustrates why a runtime decision layer evaluating signals simultaneously produces different outcomes than individual tools checking their own domain.",
        duration: "3 min",
      },
      {
        id: "d6-4",
        phase: "outcome",
        phaseLabel: "Access Outcome",
        title: "Restrict — application intake allowed, submission blocked pending review",
        narrative:
          "The decision outcome is Restrict, not Deny. Morgan can enter the client's loan application data — all fields, all documentation — but the formal submission that creates the loan record in the core banking system is blocked pending a compliance review. Morgan receives a message: 'Application saved for review — submission requires branch manager confirmation due to device compliance flags.' The branch manager and compliance team receive an alert: high-value loan submission attempted on a non-compliant device with elevated threat score after hours — review required. Morgan's client's application is protected — it won't be lost — but it won't be submitted until the situation is reviewed.",
        technicalNote:
          "The 'saved but not submitted' outcome is important for financial services buyers. It's not a hard block that creates customer experience problems. It's a workflow hold that triggers a human review. Financial institutions already have exception processes for high-value transactions — SignalGrid is adding a trigger for those exception processes.",
        duration: "2 min",
      },
      {
        id: "d6-5",
        phase: "outcome",
        phaseLabel: "Closing Frame",
        title: "MaaS360 threat intelligence + SignalGrid — the regulated industry argument",
        narrative:
          "MaaS360's threat intelligence flagged Device B's anomalous behavior. Your compliance team documented the encryption exception four weeks ago. The session was initiated after hours. None of these signals individually would have stopped the loan submission. No existing system was combining all three. SignalGrid evaluated them together, at the moment of the workflow request, and produced a calibrated outcome — application saved, submission held, review triggered. That audit trail — the signal values, the policy rule, the decision timestamp — is the compliance record that your regulators want to see.",
        technicalNote:
          "Financial services regulators (OCC, FDIC, CFPB) are increasingly interested in how banks demonstrate controls over mobile access to core banking systems. The audit trail framing resonates with compliance officers — they need to show that controls exist and were exercised, not just that policies were written.",
        duration: "1–2 min",
      },
    ],
  },
];

// Backward-compatible exports for existing component
export const demoScenario = demoScenarios[0];
export const demoSteps = demoScenarios[0].steps;

export const demoObjectionResponses = [
  {
    objection: "\"Can we see this with our actual Intune tenant?\"",
    response:
      "That's exactly what a pilot deployment would demonstrate. The sandbox uses the same Graph API endpoints as your production Intune tenant. We'd need read-only access to device compliance and a test user — we can scope this as a non-production proof of concept.",
  },
  {
    objection: "\"What happens if SignalGrid goes down? Do all workflows stop?\"",
    response:
      "SignalGrid is designed as a policy enforcement point, not as the authentication layer itself. The fail-open vs. fail-closed behavior is configurable per workflow category. High-sensitivity workflows can be fail-closed; operational continuity workflows can be fail-open with an audit event. Your existing auth stack continues to function independently.",
  },
  {
    objection: "\"We already have Conditional Access doing most of this.\"",
    response:
      "Conditional Access evaluated login time — it saw a compliant device and a valid identity and would have allowed access. SignalGrid evaluated workflow execution time with the operational signal as a second input. That signal — the open incident, the kiosk mode exit, the security agent crash — has been in your environment for hours. Conditional Access never saw it. The gap is the operational signal layer and the evaluation timing, not the identity or device compliance layer.",
  },
  {
    objection: "\"How do you handle the latency of querying multiple APIs in real time?\"",
    response:
      "SignalGrid queries signal sources in parallel with a configurable timeout per signal type. For MDM compliance signals (Intune, Workspace ONE, Hexnode), the API response time is typically 200–800ms. For real-time queries (Tanium), we allow up to 20 seconds for the question to resolve. For latency-sensitive workflows, signals can be pre-fetched and cached with a configurable staleness window — for example, device compliance cached for 15 minutes, identity signals always live.",
  },
];
