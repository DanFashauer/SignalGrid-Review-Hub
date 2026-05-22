export interface DemoStep {
  id: string;
  phase: "setup" | "trigger" | "evaluation" | "outcome";
  phaseLabel: string;
  title: string;
  narrative: string;
  technicalNote?: string;
  duration: string;
}

export const demoScenario = {
  title: "Controlled Demo: Frontline Shift-Change Access Decision",
  environment: "Healthcare — 400-bed regional hospital, shared iOS medication cart devices, Intune + Entra ID deployment",
  totalDuration: "10–12 minutes",
  prerequisite:
    "rc:smoke passing. Demo environment connected to Intune sandbox tenant. Two test user identities: Nurse A (on-shift, compliant device) and Nurse B (off-shift, device with open compliance incident).",
  openingFrame:
    "You manage 200 nurses across three shifts. They share 40 medication cart iPads. Your existing Conditional Access policy was written for knowledge workers with persistent devices. This morning, a nurse from the previous shift left a device in a non-compliant state, another nurse started their shift and picked it up, and a third device has an open Intune incident from last week. Your EHR workflow doesn't know any of this. SignalGrid does.",
};

export const demoSteps: DemoStep[] = [
  {
    id: "d1",
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
    id: "d2",
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
    id: "d3",
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
    id: "d4",
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
    id: "d5",
    phase: "outcome",
    phaseLabel: "Closing Frame",
    title: "What just happened — and why your existing stack couldn't do it",
    narrative:
      "Conditional Access saw: compliant device, valid identity. It would have allowed full EHR access. SignalGrid saw: non-compliant posture, open incident, valid identity, normal session context. It calibrated the outcome. The difference isn't that SignalGrid replaced Conditional Access — it used Intune and Entra data that Conditional Access already had, added the ServiceNow signal it didn't, and made a decision at workflow execution time instead of login time. That's the runtime decision layer.",
    technicalNote:
      "Leave audience with the phrase 'workflow execution time, not login time.' That's the positioning sentence that distinguishes SignalGrid from every adjacent tool.",
    duration: "1–2 min",
  },
];

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
      "Conditional Access evaluated login time — it saw a compliant device and a valid identity and would have allowed access. SignalGrid evaluated workflow execution time with the ServiceNow incident as a signal. That open incident has been in Intune for six days — Conditional Access never saw it. The gap is the operational signal layer, not the identity or device compliance layer.",
  },
];
