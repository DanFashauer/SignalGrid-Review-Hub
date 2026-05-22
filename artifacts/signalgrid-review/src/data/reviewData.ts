export const REVIEW_DATE = "May 2026";
export const REVIEW_VERSION = "v0.3 — Fleet Integration + Live Tracker";

export interface ScoreItem {
  dimension: string;
  score: number;
  maxScore: number;
  rationale: string;
  status: "strong" | "developing" | "gap";
}

export interface ReviewItem {
  id: string;
  title: string;
  body: string;
  tag?: string;
}

export interface DimensionReview {
  key: string;
  label: string;
  score: number;
  summary: string;
  observations: string[];
  gaps: string[];
  actions: string[];
}

export const scorecardItems: ScoreItem[] = [
  {
    dimension: "Product Readiness",
    score: 5,
    maxScore: 10,
    rationale:
      "Core runtime decision layer concept is technically coherent and differentiated. The signal evaluation model is credible. Gap is the absence of any validated integration against a real enterprise identity or device posture stack — the system has not yet been exercised outside a controlled build environment.",
    status: "developing",
  },
  {
    dimension: "Integration Surface Coverage",
    score: 3,
    maxScore: 10,
    rationale:
      "No working integration with a production-adjacent identity provider (Entra ID, Okta), MDM platform (Intune, Jamf, Fleet), or workflow system (ServiceNow, Jira) has been validated. Fleet MDM is now the fastest P1 path: open source, free sandbox via fleetctl preview, and a full REST + osquery API. First validated integration moves this score to 5. This is the single highest-impact gap before any external conversation.",
    status: "gap",
  },
  {
    dimension: "Demo Readiness",
    score: 8,
    maxScore: 10,
    rationale:
      "rc:smoke workflow is complete and passing. The demo environment is stable. A scripted, 5-step demo narrative for the healthcare shift-change scenario has been written and documented in this workspace. Remaining gap: no recorded async walkthrough exists, and the script has not yet been rehearsed with an external observer.",
    status: "strong",
  },
  {
    dimension: "Brand & Visual Assets",
    score: 7,
    maxScore: 10,
    rationale:
      "Landing page is live with a defined visual identity. Execution quality is above average for a pre-revenue B2B security project. Gaps: no one-pager for email distribution, no pitch deck at the same visual standard, brand guidelines not formalized.",
    status: "strong",
  },
  {
    dimension: "Launch Outreach",
    score: 5,
    maxScore: 10,
    rationale:
      "Outreach package assembled. Target segment is plausible. Package has not been activated — no sends, no replies, no qualified conversations. ICP definition is internally validated only. The gap between preparation and activation is where most pre-launch B2B projects stall.",
    status: "developing",
  },
  {
    dimension: "GitHub Hygiene",
    score: 8,
    maxScore: 10,
    rationale:
      "Repo cleanup complete. rc:smoke CI passing. Repository is in credible shape for external technical review. Minor deductions: notification noise unresolved, branch protection status unconfirmed. Neither is structural.",
    status: "strong",
  },
  {
    dimension: "Market Positioning",
    score: 6,
    maxScore: 10,
    rationale:
      "Positioning as runtime decision layer for shared-device and mobile frontline environments is specific and defensible. Conservative framing — explicitly not replacing IAM, UEM, SIEM, or ITSM — is correct. Gap: no crisp answer to the 'just extend our existing Conditional Access / Okta policy engine' objection.",
    status: "developing",
  },
  {
    dimension: "Next-Step Clarity",
    score: 7,
    maxScore: 10,
    rationale:
      "A 30/60/90-day activation plan with milestone exit gates and outreach batch tracking now exists in this workspace. Remaining gaps: milestones do not have named owners, and the outreach batch send date has not been set to a specific date. Neither is structural — both are decisions.",
    status: "strong",
  },
];

export const strengths: ReviewItem[] = [
  {
    id: "s1",
    title: "Differentiated problem framing",
    body: "SignalGrid is not trying to replace any incumbent stack. The framing as a decision layer that evaluates identity, device posture, session context, and operational signals before workflows break is genuinely differentiated. This is a wedge, not a category replacement — and that restraint is a strategic asset in enterprise security sales.",
    tag: "Positioning",
  },
  {
    id: "s2",
    title: "Target environment is well-specified",
    body: "Shared-device and mobile frontline environments — healthcare, logistics, field operations — represent a real and underserved surface area in Zero Trust architecture. Most ZT narratives are built for knowledge-worker scenarios with persistent, managed devices. SignalGrid is addressing the harder, less crowded problem.",
    tag: "Market",
  },
  {
    id: "s3",
    title: "Technical scaffolding is ahead of typical pre-seed",
    body: "rc:smoke passing, repo cleanup complete, and a stable demo environment represent genuine engineering discipline. Most projects at this stage are still whiteboard-and-deck. Having a testable artifact changes the quality of the first technical conversation.",
    tag: "Engineering",
  },
  {
    id: "s4",
    title: "Brand execution is above the category baseline",
    body: "A live landing page with defined visual identity at this stage signals seriousness. First impressions carry disproportionate weight in enterprise security, where buyers are risk-averse and credibility cues are evaluated before product details.",
    tag: "Brand",
  },
  {
    id: "s5",
    title: "Conservative language is the right call",
    body: "Not claiming production readiness, compliance certifications, or validated enterprise integrations protects credibility and avoids commitments that would be difficult to walk back. This restraint is a deliberate choice and a durable differentiator versus vendors who overclaim.",
    tag: "Positioning",
  },
];

export const risks: ReviewItem[] = [
  {
    id: "r1",
    title: "No validated integration story",
    body: "The runtime decision layer concept depends entirely on integrating with identity providers, MDM platforms, and workflow systems. Without at least one working integration against a real enterprise stack — even in a sandbox — the product story is theoretical. Fleet MDM is the fastest path to first proof: open source, free sandbox (fleetctl preview), full REST API, and device posture via osquery. This is the most important gap before any enterprise buyer conversation.",
    tag: "Product",
  },
  {
    id: "r2",
    title: "Outreach package has not been activated",
    body: "An assembled package that hasn't been sent is functionally equivalent to no outreach. Without a specific send date, batch size, and response classification criteria, the outreach will remain in preparation indefinitely.",
    tag: "Go-to-Market",
  },
  {
    id: "r3",
    title: "ICP definition is internally validated only",
    body: "The ideal customer profile has been reasoned from first principles. There is meaningful risk that the assumed buyer (operations leadership in shared-device environments) is not the actual economic buyer or technical champion in target organizations. Five discovery conversations would resolve most of this.",
    tag: "Market",
  },
  {
    id: "r4",
    title: "Competitive differentiation needs one more sharpening pass",
    body: "The 'just extend our existing Conditional Access / Okta policy engine' objection will surface in the first ten prospect conversations. Current materials flag this as a gap but don't answer it. That answer needs to be written and rehearsed before the first call.",
    tag: "Positioning",
  },
  {
    id: "r5",
    title: "Activation plan exists — has not been executed",
    body: "A 30/60/90-day plan with exit gates now exists. The risk has shifted: it is no longer the absence of a plan, it is the absence of a committed send date and an assigned owner for each milestone. Plans without owners and dates become artifacts, not commitments.",
    tag: "Execution",
  },
  {
    id: "r6",
    title: "GitHub Actions notification volume",
    body: "High-volume, low-signal CI emails are a solvable operational issue. In a small-team environment, ambient noise competes directly with strategic focus. Repository Watch → Custom → uncheck 'Actions' is a 10-minute fix.",
    tag: "Operations",
  },
];

export const openQuestions: ReviewItem[] = [
  {
    id: "q1",
    title: "Who is the economic buyer vs. the technical champion?",
    body: "In healthcare and logistics, IT, operations, and compliance buyers have distinct incentive structures. Which persona initiates the SignalGrid conversation — and who signs the purchase order?",
    tag: "Market",
  },
  {
    id: "q2",
    title: "What does the integration surface look like in practice?",
    body: "Which identity providers and MDM platforms are in scope for v1? What is the implementation complexity for a 500-seat logistics company running shared iOS devices against a mixed Intune/Active Directory environment?",
    tag: "Product",
  },
  {
    id: "q3",
    title: "What is the first externally observable proof point?",
    body: "rc:smoke validates internal build quality. What is the first proof point a prospect or partner could independently verify — a sandbox integration, a reference deployment, a documented API contract?",
    tag: "Validation",
  },
  {
    id: "q4",
    title: "How does SignalGrid answer the 'extend existing stack' objection?",
    body: "Most enterprise buyers will first attempt to solve this with Conditional Access policy extensions or Okta's device trust layer. What is the 45-second response to 'we already have this in our existing stack'?",
    tag: "Positioning",
  },
  {
    id: "q5",
    title: "What does successful outreach look like at 30 days?",
    body: "How many conversations should the first batch generate? What qualifies as a warm response vs. a polite decline? What is the follow-up cadence and who owns it?",
    tag: "Go-to-Market",
  },
  {
    id: "q6",
    title: "What is the minimum viable pilot scope?",
    body: "What does a 90-day pilot deployment look like for a 200-bed healthcare system running shared iOS devices? What signals does SignalGrid need to evaluate, what integrations are required, and what is the success metric the customer measures?",
    tag: "Product",
  },
];

export const recommendedActions: ReviewItem[] = [
  {
    id: "a1",
    title: "Complete first integration proof — Fleet MDM is the fastest path",
    body: "Install fleetctl (curl -sSL https://fleetdm.com/resources/install-fleetctl.sh | bash) and run fleetctl preview for a local sandbox with enrolled devices in under 10 minutes. Build the device posture signal integration against Fleet's policy API. Alternatively, pursue Intune/Entra Graph API in a Microsoft sandbox. Either advances product credibility immediately. Aim for a demo-able artifact within 14 days.",
    tag: "Priority 1",
  },
  {
    id: "a2",
    title: "Activate outreach with a specific send date",
    body: "Set a specific date — not a range — for the first batch of 20–30 sends. Define what counts as a qualified response. Review results after the first batch regardless of outcome and iterate before the second.",
    tag: "Priority 1",
  },
  {
    id: "a3",
    title: "Fix GitHub Actions notification noise",
    body: "Repository → Watch → Custom → uncheck 'Actions' or restrict to failed runs only. Alternatively, filter CI notification emails at the inbox level. 10-minute fix, disproportionate quality-of-life impact.",
    tag: "Priority 2",
  },
  {
    id: "a4",
    title: "Write the 'extend existing stack' objection response",
    body: "Draft a 150-word answer to 'why not just use Conditional Access / Okta policy extensions?' Test it in peer review. Refine before the first live call. Map the specific gap each adjacent vendor leaves in shared-device environments.",
    tag: "Priority 2",
  },
  {
    id: "a5",
    title: "Assign owners and set dates on the 30/60/90 milestones",
    body: "The activation plan with exit gates exists in this workspace. The remaining step is assigning a named owner to each milestone and setting a specific date — not a range — for the Day 30 outreach send. Without an owner and a date, a plan is a document, not a commitment.",
    tag: "Priority 2",
  },
  {
    id: "a6",
    title: "Conduct 5 customer discovery conversations",
    body: "Test ICP assumptions against actual operations or IT leaders in healthcare or logistics. Five 20-minute conversations will surface objections, vocabulary mismatches, and unexpected use cases that no amount of internal iteration will reveal.",
    tag: "Priority 3",
  },
  {
    id: "a7",
    title: "Rehearse the demo script with one external observer",
    body: "The scripted healthcare shift-change demo narrative exists in this workspace. The remaining step is running the full script with a technical observer who can flag every improvised moment. Those moments need to be scripted before the first live prospect call. Record the rehearsal for async distribution.",
    tag: "Priority 3",
  },
  {
    id: "a8",
    title: "Extend brand standard to one-pager and short deck",
    body: "The landing page visual standard should carry forward into a one-page product overview for email distribution and a 10-slide pitch deck. These are the artifacts that circulate in email threads when you are not in the room.",
    tag: "Priority 3",
  },
];

export const dimensionReviews: DimensionReview[] = [
  {
    key: "product",
    label: "Product Readiness",
    score: 5,
    summary:
      "The runtime decision layer concept is technically coherent and the problem framing is defensible. The four-signal model — identity, device posture, session context, operational signals — is genuinely differentiated. The gap is between architectural clarity and validated integration against real enterprise stacks.",
    observations: [
      "Core decision engine concept is well-articulated and technically credible",
      "Problem framing correctly targets the shared-device and mobile frontline gap in existing Zero Trust architectures",
      "rc:smoke passing indicates build quality discipline above the pre-seed baseline",
      "No validated integrations with identity providers, MDM platforms, or workflow systems",
      "No reference to a pilot deployment, sandbox customer, or externally reviewed API contract",
    ],
    gaps: [
      "No working integration against a real enterprise identity or device posture stack (Intune, Entra, Okta, Jamf)",
      "No external validation of the decision model against production signal data",
      "API surface and integration contract not publicly documented or versioned",
    ],
    actions: [
      "Build first proof-of-concept integration against Intune/Entra ID device compliance in a sandbox environment",
      "Document the integration contract and signal schema for external technical review",
      "Define minimum viable product scope for a first 90-day pilot deployment",
    ],
  },
  {
    key: "integration",
    label: "Integration Surface Coverage",
    score: 3,
    summary:
      "Zero working integrations with production-adjacent enterprise stacks have been validated. This is the most structurally important gap in the entire review. The runtime decision layer is only meaningful if it can actually receive signals from the stacks that generate them — Entra ID, Intune, Jamf, Okta, ServiceNow.",
    observations: [
      "No integration with any identity provider has been validated (Entra ID, Okta, Azure AD)",
      "No integration with any MDM/UEM platform has been validated (Intune, Jamf, SOTI, MobileIron)",
      "No integration with any ITSM or workflow system has been validated (ServiceNow, Jira, Freshservice)",
      "First Intune/Entra posture proof is the named priority target — not yet completed",
      "Integration contract and signal schema are not publicly documented",
    ],
    gaps: [
      "No sandbox-validated integration with Intune device compliance API",
      "No sandbox-validated integration with Entra ID (conditional access / device posture signals)",
      "No documented signal schema showing how each source system maps to SignalGrid's four signal types",
    ],
    actions: [
      "Complete Intune sandbox integration: device compliance status, device posture evaluation, access outcome",
      "Complete Entra ID integration: user identity, device registration, conditional access signal",
      "Publish a signal schema document mapping source systems to identity / device posture / session context / operational signal types",
    ],
  },
  {
    key: "demo",
    label: "Demo Readiness",
    score: 7,
    summary:
      "Build environment is stable and smoke test is passing. This is ahead of the pre-seed baseline. The gap is narrative: a scripted, repeatable demo story with a defined before state, decision trigger, and resolution that a non-technical founder can deliver consistently.",
    observations: [
      "rc:smoke CI workflow is passing",
      "Demo environment is stable and controllable",
      "Build discipline is above average for this stage",
      "No scripted demo narrative with defined setup, trigger, and resolution",
      "No recorded async walkthrough for asynchronous prospect review",
      "Demo is tied to a functional environment — no 'offline' demo backup for unreliable conference wifi",
    ],
    gaps: [
      "No scripted demo narrative with explicit before/after problem framing",
      "No async demo artifact (recorded walkthrough) for asynchronous distribution",
      "No rehearsed responses to the three most likely demo interruptions",
    ],
    actions: [
      "Write a 10-minute scripted demo narrative: before state → decision trigger → resolution",
      "Record one walkthrough video for async distribution to prospects who can't make a live call",
      "Rehearse with one external observer and capture three objection responses before the first live meeting",
    ],
  },
  {
    key: "brand",
    label: "Brand & Visual Assets",
    score: 7,
    summary:
      "Landing page is live with a credible, consistent visual identity. Execution quality is above the pre-revenue B2B security baseline. The gap is collateral: no one-pager for email distribution, no deck at the same visual standard, brand guidelines not formalized.",
    observations: [
      "Landing page is live with defined visual identity and wordmark",
      "Color system and type appear consistent across reviewed materials",
      "Visual execution quality is above average for a pre-revenue B2B security project",
      "No one-page product overview for email distribution",
      "No pitch deck at the same visual standard as the landing page",
      "Brand guidelines not formalized — consistency will drift as output volume increases",
    ],
    gaps: [
      "No one-page product overview for email distribution",
      "No short pitch deck carrying the brand standard",
      "Brand guidelines not documented — type, color, logo usage rules",
    ],
    actions: [
      "Create a one-page product overview (problem, solution framing, who it's for, next step) for outreach email attachment",
      "Build a 10-slide deck: problem, solution, four signal types, integration story, competitive positioning, ask",
      "Document core brand elements in a one-page guide: color values, type stack, logo usage, do/don'ts",
    ],
  },
  {
    key: "outreach",
    label: "Launch Outreach",
    score: 5,
    summary:
      "An outreach package exists but has not been activated. The gap is the activation sequence: a specific send date, a batch size, and qualification criteria for what counts as a response worth pursuing.",
    observations: [
      "Outreach package has been assembled and reviewed",
      "Target segment framing is plausible relative to the product positioning",
      "Package has not been sent — zero sends, zero replies, zero qualified conversations",
      "ICP definition has not been validated through external customer discovery",
      "No response classification criteria defined (warm lead vs. polite decline vs. no response)",
    ],
    gaps: [
      "No specific activation date — preparation without a launch date stalls indefinitely",
      "No ICP validation through external customer discovery conversations",
      "No response classification criteria or follow-up cadence defined",
    ],
    actions: [
      "Set a specific send date for first batch — date, not a range",
      "Define batch size (20–30) and response classification criteria before sending",
      "Book 5 discovery conversations with operations or IT leaders in healthcare or logistics to validate ICP assumptions",
    ],
  },
  {
    key: "github",
    label: "GitHub Hygiene",
    score: 8,
    summary:
      "Repo cleanup complete, CI passing, repository is in credible shape for external technical review. This is a genuine strength. Remaining deductions reflect unresolved notification noise and unconfirmed branch protection state.",
    observations: [
      "Repo cleanup confirmed complete",
      "rc:smoke CI workflow passing",
      "Repository structure and README are clean based on reported state",
      "GitHub Actions notification volume is a named, unresolved concern",
      "Branch protection rules on main not confirmed",
    ],
    gaps: [
      "GitHub Actions notification noise not yet resolved",
      "Branch protection and contribution workflow not documented or confirmed",
    ],
    actions: [
      "Repository → Watch → Custom → notifications for direct mentions, failed runs, and security alerts only",
      "Confirm branch protection rules are active on main: require PR, require status checks, restrict force push",
      "Route CI notifications to a dedicated email label or Slack channel for triage",
    ],
  },
  {
    key: "positioning",
    label: "Market Positioning",
    score: 6,
    summary:
      "Positioning is specific, defensible, and correctly restrained. The shared-device and frontline environment framing targets a real gap in the Zero Trust landscape. The affirmative case — what SignalGrid does that extending existing stack components cannot — needs one more sharpening pass.",
    observations: [
      "Runtime decision layer positioning for shared-device and frontline environments is differentiated",
      "Conservative framing (not replacing IAM/UEM/SIEM/ITSM) protects credibility",
      "Zero Trust orchestration framing aligns with current enterprise security vocabulary",
      "Competitive differentiation from Okta Device Trust, CrowdStrike ZTA, Microsoft Conditional Access not yet articulated",
      "The 'extend existing stack' objection is identified but not answered in current materials",
    ],
    gaps: [
      "No crisp answer to the 'extend existing stack / Conditional Access already does this' objection",
      "Competitive landscape not mapped: what each adjacent vendor specifically cannot do in shared-device environments",
      "Customer vocabulary alignment not validated through discovery conversations",
    ],
    actions: [
      "Write a 150-word 'why SignalGrid vs. stack extension' response — test in peer review before first call",
      "Map three adjacent vendors: Okta Device Trust, Microsoft Conditional Access, CrowdStrike ZTA — one specific shared-device gap per vendor",
      "Validate positioning language with 3 security practitioners or enterprise IT leaders before finalizing",
    ],
  },
  {
    key: "nextsteps",
    label: "Next-Step Clarity",
    score: 6,
    summary:
      "General direction exists. No crisp 30/60/90-day plan with owners, exit criteria, or decision gates. The gap between 'outreach package assembled' and 'first call booked' is not bridged by a concrete activation sequence.",
    observations: [
      "A general sense of direction exists — integrate, outreach, validate",
      "No written 30/60/90-day plan with specific milestones and exit criteria",
      "No named owner for next-step execution items",
      "No decision gate defining what triggers the transition from pre-launch to active outreach",
    ],
    gaps: [
      "No 30/60/90-day plan with specific success criteria and owners",
      "No decision gate criteria defining when pre-launch preparation is complete",
      "No defined cadence for reviewing progress against milestones",
    ],
    actions: [
      "Write a one-page 30/60/90-day plan: 30 = first call booked, 60 = pilot candidate identified, 90 = working integration in customer-adjacent env",
      "Assign a named owner or time block to each Priority 1 and Priority 2 action item",
      "Set a weekly 30-minute review cadence to assess progress against milestones",
    ],
  },
];

export const overallScore = {
  value: 6.1,
  maxValue: 10,
  label: "Pre-Launch Readiness",
  interpretation:
    "SignalGrid is in a credible pre-launch position with above-average engineering, brand, and demo readiness for this stage. A 30/60/90-day activation plan now exists. The dominant remaining gap is integration surface coverage: zero validated integrations with any enterprise stack. Fleet MDM is the fastest path to first proof — open source, free sandbox in under 10 minutes, full REST API. Completing the first integration proof is the single action that most advances product credibility and the composite score simultaneously.",
};
