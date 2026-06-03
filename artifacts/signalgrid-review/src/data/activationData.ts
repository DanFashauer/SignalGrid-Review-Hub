export type MilestoneStatus = "not-started" | "in-progress" | "complete" | "blocked";

export interface Milestone {
  id: string;
  day: string;
  title: string;
  successCriteria: string;
  status: MilestoneStatus;
  tasks: string[];
  exitGate: string;
}

export interface OutreachBatch {
  id: string;
  batchNumber: number;
  targetSize: number;
  sendDate: string;
  status: "planned" | "sent" | "complete";
  icpProfile: string;
  responsesCounted: number;
  qualifiedConversations: number;
  notes: string;
}

export const activationMilestones: Milestone[] = [
  {
    id: "m30",
    day: "Day 30",
    title: "First External Conversation Booked",
    successCriteria:
      "At least one qualified conversation booked with an operations or IT leader in a healthcare, logistics, or field operations organization. 'Qualified' means they manage shared-device workflows and have budget authority or strong influence on technology decisions.",
    status: "in-progress",
    tasks: [
      "Activate outreach batch 1 (20–30 sends) by set date",
      "Follow up on non-responses at day 5 and day 10",
      "Book and confirm at least one 30-minute discovery call",
      "Complete first integration proof: Microsoft Intune / Entra posture proof",
      "Use Microsoft sandbox data or deterministic fixtures for device ID, compliance state, management state, check-in freshness, and audit outcome",
    ],
    exitGate:
      "One confirmed discovery call on the calendar with a qualified prospect.",
  },
  {
    id: "m60",
    day: "Day 60",
    title: "One Qualified Pilot Candidate Identified",
    successCriteria:
      "One organization has expressed specific interest in a pilot deployment. Pilot scope is defined: which workflows, which device fleet, which integration stack. A named internal champion exists at the organization.",
    status: "not-started",
    tasks: [
      "Complete 3–5 discovery conversations from batch 1 outreach",
      "Send outreach batch 2 based on learnings from batch 1",
      "Develop pilot proposal template (scope, integration requirements, success metrics, timeline)",
      "Complete second integration proof: Jamf, Fleet, Workspace ONE, broader UEM connector, or Okta Device Trust integration",
      "Publish signal schema document mapping Intune/Entra first, then Fleet/Jamf/UEM follow-on paths → four signal types",
    ],
    exitGate:
      "A signed NDA or pilot MOU, or at minimum a written scope document agreed by both parties.",
  },
  {
    id: "m90",
    day: "Day 90",
    title: "Working Integration in Customer-Adjacent Environment",
    successCriteria:
      "SignalGrid is receiving live signals from at least two integration sources in a staging or sandbox environment that mirrors a pilot customer's stack. Decision engine is evaluating real signal combinations. At least one documented scenario produces a correct access outcome.",
    status: "not-started",
    tasks: [
      "Deploy integration stack in customer-adjacent sandbox (Intune/Entra first, then Fleet/Jamf/UEM follow-on posture connectors)",
      "Demonstrate at least 3 distinct decision scenarios: allow, step-up, restrict",
      "Document integration setup, signal schema, and decision scenarios for pilot proposal",
      "Prepare reference architecture diagram for pilot customer presentation",
      "Record async demo walkthrough for pilot candidate's technical team",
    ],
    exitGate:
      "A recorded demo of the working integration that can be shared asynchronously with a pilot candidate's technical team.",
  },
];

export const milestoneStatusMeta: Record<
  MilestoneStatus,
  { label: string; color: string; dot: string; border: string }
> = {
  "not-started": {
    label: "Not Started",
    color: "text-stone-500",
    dot: "bg-stone-600",
    border: "border-stone-700",
  },
  "in-progress": {
    label: "In Progress",
    color: "text-amber-400",
    dot: "bg-amber-500",
    border: "border-amber-700",
  },
  complete: {
    label: "Complete",
    color: "text-teal-400",
    dot: "bg-teal-500",
    border: "border-teal-700",
  },
  blocked: {
    label: "Blocked",
    color: "text-red-400",
    dot: "bg-red-600",
    border: "border-red-800",
  },
};

export const outreachBatches: OutreachBatch[] = [
  {
    id: "batch1",
    batchNumber: 1,
    targetSize: 25,
    sendDate: "TBD — set a specific date",
    status: "planned",
    icpProfile:
      "Operations director or IT manager at a 200–2000 employee organization in healthcare, logistics, or field services. Uses shared iOS or Android devices across a frontline workforce. Has responsibility for workflow continuity and device management.",
    responsesCounted: 0,
    qualifiedConversations: 0,
    notes:
      "First batch is a learning exercise as much as an outreach exercise. Track open rate, reply rate, and objection patterns. Do not optimize copy before batch 1 results are in.",
  },
];
