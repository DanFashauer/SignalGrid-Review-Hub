export interface CompetitorRow {
  id: string;
  vendor: string;
  product: string;
  category: string;
  whatItDoes: string;
  sharedDeviceGap: string;
  signalgridDifference: string;
  threat: "low" | "medium" | "high";
}

export const competitors: CompetitorRow[] = [
  {
    id: "msft-ca",
    vendor: "Microsoft",
    product: "Conditional Access",
    category: "Identity / Access Policy",
    whatItDoes:
      "Evaluates identity and device compliance state at authentication time to grant, restrict, or block access. Deeply integrated with Entra ID and Intune. The default Zero Trust policy layer for Microsoft-stack organizations.",
    sharedDeviceGap:
      "Conditional Access evaluates policy at login time and assumes a persistent user-device relationship. In shared-device scenarios where multiple workers use the same device across shifts, Conditional Access can't re-evaluate signals mid-session or distinguish shift-change risk events. It also doesn't natively consume ITSM or operational signals (e.g., open incident for the device) as policy inputs.",
    signalgridDifference:
      "SignalGrid evaluates its trust signals at the moment a workflow action fires — not just at login — with physical custody and badge binding as first-class inputs. Consuming operational/ITSM signals (shift changes, open incidents) as decision inputs is a roadmap direction, not evaluated today. SignalGrid complements Conditional Access rather than being a substitute for it.",
    threat: "high",
  },
  {
    id: "okta-dt",
    vendor: "Okta",
    product: "Okta Device Trust",
    category: "Identity / Device Verification",
    whatItDoes:
      "Verifies that a device is managed and compliant before granting SSO access. Integrates with Jamf, Intune, and SCCM to pull device compliance state into Okta policies. Session-level enforcement on initial authentication.",
    sharedDeviceGap:
      "Okta Device Trust is designed for persistent, user-owned devices where a certificate or managed profile ties the device to an individual identity. In shared-device environments — particularly iOS shared device mode — the certificate-based trust model breaks down. Okta has limited native support for Apple Shared Device Mode scenarios, and like Conditional Access, it doesn't consume ITSM operational signals.",
    signalgridDifference:
      "SignalGrid is purpose-built for environments where the device is not persistently tied to one user identity. It evaluates session context and operational signals that Okta's policy engine doesn't natively access, and it evaluates them at workflow execution time rather than session initiation.",
    threat: "high",
  },
  {
    id: "cs-zta",
    vendor: "CrowdStrike",
    product: "Falcon Zero Trust Assessment",
    category: "Endpoint Security / Posture",
    whatItDoes:
      "Provides a continuous device security score (ZTA score) based on endpoint health, sensor state, and detected threats. Integrates with identity providers to include device posture in access policy decisions. Designed primarily for managed enterprise endpoints.",
    sharedDeviceGap:
      "Falcon ZTA is built for persistent, individually managed endpoints where the Falcon sensor runs continuously. It is not designed for shared iOS devices in locked-down Supervised mode, point-of-sale terminals, or logistics scanners where the Falcon agent isn't installed or licensed. The ZTA score reflects endpoint threat posture, not the operational signals (shift context, ITSM incidents) relevant to frontline workflow decisions.",
    signalgridDifference:
      "SignalGrid targets environments where CrowdStrike isn't deployed (shared mobile, frontline IoT-adjacent devices) and evaluates signal types — operational signals, session context — that endpoint security platforms don't produce. In environments where both exist, CrowdStrike posture data can be a signal input to SignalGrid's decision engine.",
    threat: "medium",
  },
  {
    id: "servicenow-iam",
    vendor: "ServiceNow",
    product: "Identity Governance & Administration",
    category: "IGA / ITSM Integration",
    whatItDoes:
      "Manages identity lifecycle, access certifications, and role-based access governance. Integrates with HR systems, directory services, and ITSM workflows. Primarily a compliance and governance tool rather than a real-time access enforcement layer.",
    sharedDeviceGap:
      "ServiceNow IGA operates on a certification and provisioning model — it governs who *should* have access, not what access should be *allowed right now* given current operational state. It doesn't evaluate device posture, session context, or real-time identity signals. In a shared-device scenario, IGA doesn't know or care that the device has an open incident or that the worker's shift has ended.",
    signalgridDifference:
      "SignalGrid operates at a different layer — real-time decision enforcement rather than governance and certification. ServiceNow ITSM is a *source* of operational signals for SignalGrid, not a competitor. The relationship is complementary.",
    threat: "low",
  },
];

export const threatMeta = {
  low: { label: "Low overlap", color: "text-stone-400", dot: "bg-stone-500", bg: "bg-stone-900/30" },
  medium: { label: "Partial overlap", color: "text-amber-400", dot: "bg-amber-500", bg: "bg-amber-900/20" },
  high: { label: "Direct objection risk", color: "text-red-400", dot: "bg-red-600", bg: "bg-red-900/20" },
};

export const objectionResponse = {
  title: "The 'extend existing stack' objection — prepared response",
  objection:
    "\"We already have Conditional Access / Okta policies / CrowdStrike ZTA. Why do we need another layer?\"",
  response:
    "Conditional Access and Okta evaluate identity and device state at login time, on the assumption that the device belongs to one person and that person's risk profile stays constant through the session. In your shared-device environment, that assumption breaks. A device used by three nurses across a shift has a different risk surface at the start of each session. A logistics scanner with an open maintenance incident should not have the same access as a compliant device — but Conditional Access won't know about that incident. SignalGrid sits between your existing authentication layer and your workflows. It consumes signals your existing stack already generates — Intune compliance and Entra identity — and is designed to add the signals it doesn't: shift context, ITSM operational state, real-time session anomalies (deferred, not Limited GA). It doesn't replace what you have. It makes your workflow access decisions smarter for the environments your existing tools weren't designed for.",
};
