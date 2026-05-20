export const REVIEW_DATE = "May 2025";
export const REVIEW_VERSION = "v0.1 — Pre-Launch Second Opinion";

export interface ScoreItem {
  dimension: string;
  score: number;
  maxScore: number;
  rationale: string;
  status: "strong" | "developing" | "gap";
}

export interface ReviewItem {
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
      "Core concept is coherent and differentiated. Runtime decision layer architecture is technically credible. However, no validated live integrations exist and the system has not been exercised against real enterprise identity or device posture stacks. Appropriate for pre-seed exploration, not customer pilot.",
    status: "developing",
  },
  {
    dimension: "Demo Readiness",
    score: 7,
    maxScore: 10,
    rationale:
      "rc:smoke workflow is complete and passing. Basic demo flows appear functional in a controlled environment. Primary gap is the absence of a scripted, repeatable narrative that a non-technical founder could walk through without improvisation.",
    status: "strong",
  },
  {
    dimension: "Brand & Visual Assets",
    score: 7,
    maxScore: 10,
    rationale:
      "Landing page is live. Visual identity is defined with a recognizable wordmark and color system. Quality appears above average for a pre-revenue project. Main gap: no cohesive one-pager or pitch deck that carries the same visual standard.",
    status: "strong",
  },
  {
    dimension: "Launch Outreach",
    score: 5,
    maxScore: 10,
    rationale:
      "An outreach package has been assembled. Target segment appears plausible. However, the package has not been activated — no outreach has gone out, no reply rate data exists, and the ICP definition remains internally validated only.",
    status: "developing",
  },
  {
    dimension: "GitHub Hygiene",
    score: 8,
    maxScore: 10,
    rationale:
      "Repo cleanup is confirmed complete. CI smoke test is passing. README and repo structure are in reasonable shape for external review. Minor deduction for unresolved workflow notification noise, which creates cognitive overhead.",
    status: "strong",
  },
  {
    dimension: "Workflow Automation Noise",
    score: 4,
    maxScore: 10,
    rationale:
      "GitHub Actions notification volume is a named concern. High-frequency, low-signal emails erode attention over time. This is a fixable operational detail but has not been addressed yet. Low severity, non-trivial nuisance.",
    status: "gap",
  },
  {
    dimension: "Market Positioning",
    score: 6,
    maxScore: 10,
    rationale:
      "The positioning as a runtime decision layer for shared-device / mobile frontline environments is specific and defensible. The category framing — not replacing IAM, UEM, SIEM, or ITSM — is appropriately conservative. Competitive differentiation from adjacent players (Okta, CrowdStrike, ServiceNow) needs one more sharpening pass.",
    status: "developing",
  },
  {
    dimension: "Next-Step Clarity",
    score: 6,
    maxScore: 10,
    rationale:
      "There is a general sense of direction but no crisp 30/60/90-day plan with owners, exit criteria, or decision gates. The gap between 'outreach package assembled' and 'first call booked' is not yet bridged by a concrete activation sequence.",
    status: "developing",
  },
];

export const strengths: ReviewItem[] = [
  {
    title: "Differentiated problem framing",
    body: "SignalGrid is not trying to replace any incumbent stack. The framing as a decision layer that evaluates identity, device posture, session context, and operational signals before workflows break is genuinely differentiated. This is a wedge, not a category replacement — and that restraint is a strategic asset.",
    tag: "Positioning",
  },
  {
    title: "Target environment is well-specified",
    body: "Shared-device and mobile frontline environments (healthcare, logistics, field operations) represent a real and underserved surface area in Zero Trust architecture. Most Zero Trust narratives are built for knowledge-worker scenarios with persistent, managed devices. SignalGrid is addressing the harder problem.",
    tag: "Market",
  },
  {
    title: "Technical scaffolding is ahead of typical pre-seed",
    body: "rc:smoke passing, repo cleanup complete, and a working demo environment represent genuine engineering discipline. Most projects at this stage are still in whiteboard-and-deck territory. Having a testable artifact is a meaningful differentiator in early conversations.",
    tag: "Engineering",
  },
  {
    title: "Brand execution is above the baseline",
    body: "A live landing page and defined visual identity at this stage signals seriousness. First impressions matter disproportionately in enterprise security, where buyers are risk-averse and credibility cues are weighted heavily.",
    tag: "Brand",
  },
  {
    title: "Conservative language is the right call",
    body: "Not claiming production readiness, compliance certifications, or validated enterprise integrations protects credibility and avoids commitments that would be difficult to walk back in early customer conversations.",
    tag: "Positioning",
  },
];

export const risks: ReviewItem[] = [
  {
    title: "No validated integration story",
    body: "The runtime decision layer concept requires integration with identity providers, MDM/UEM platforms, and workflow systems. Without at least one validated, working integration against a real enterprise stack (even in a sandbox), the product story is theoretical. This is the single most important gap to close before any enterprise buyer conversation.",
    tag: "Product",
  },
  {
    title: "Outreach package has not been activated",
    body: "An assembled package that hasn't been sent is not an outreach program. The gap between preparation and activation is where most early-stage B2B projects stall. Without a concrete activation sequence — who sends what, to whom, when, and what qualifies as a response worth pursuing — the outreach will remain dormant.",
    tag: "Go-to-Market",
  },
  {
    title: "ICP definition is internally validated only",
    body: "The ideal customer profile has been reasoned from first principles rather than confirmed through customer discovery conversations. There is meaningful risk that the assumed buyer (operations leadership in shared-device environments) is not the actual economic buyer or champion in target organizations.",
    tag: "Market",
  },
  {
    title: "Competitive differentiation needs one more sharpening pass",
    body: "The current positioning avoids claiming to replace IAM/UEM/SIEM — which is correct — but does not yet articulate a crisp answer to 'why not just extend our existing Okta/CrowdStrike/ServiceNow deployment?' That objection will surface in the first ten prospect conversations.",
    tag: "Positioning",
  },
  {
    title: "No 30/60/90-day activation plan",
    body: "The project appears to be in a state of 'ready to launch' without a defined launch sequence. Without exit criteria, decision gates, and explicit ownership of the next actions, readiness states can persist indefinitely without producing external momentum.",
    tag: "Execution",
  },
  {
    title: "Workflow notification noise is an unforced error",
    body: "High-volume, low-signal GitHub Actions emails are a solvable problem and an unnecessary drain on attention. In a single-founder or small-team environment, operational noise competes directly with strategic focus.",
    tag: "Operations",
  },
];

export const openQuestions: ReviewItem[] = [
  {
    title: "Who is the economic buyer vs. the technical champion?",
    body: "In healthcare and logistics, the IT buyer, the operations buyer, and the compliance buyer all have distinct incentive structures. Which persona is most likely to initiate a SignalGrid conversation — and who signs the check?",
    tag: "Market",
  },
  {
    title: "What does the integration surface look like in practice?",
    body: "Which identity providers and MDM platforms are in scope for v1? What is the expected implementation complexity for a 500-seat logistics company that runs a mix of iOS shared devices and a legacy Active Directory deployment?",
    tag: "Product",
  },
  {
    title: "What is the first proof point that isn't a smoke test?",
    body: "rc:smoke validates internal build quality. What is the first externally observable proof point — a pilot deployment, a partner integration, a published case study, a reference customer willing to take a call?",
    tag: "Validation",
  },
  {
    title: "How does SignalGrid handle the 'just extend our existing stack' objection?",
    body: "Most enterprise security buyers will attempt to solve this with an existing vendor before evaluating a net-new tool. What is the 30-second response to a prospect who says their MDM vendor or identity provider already has a policy engine?",
    tag: "Positioning",
  },
  {
    title: "What does a successful outreach sequence look like at 30 days?",
    body: "How many conversations should the outreach package generate? What is the definition of a qualified conversation versus a polite no? What is the follow-up cadence?",
    tag: "Go-to-Market",
  },
  {
    title: "Is the GitHub workflow noise issue a configuration gap or a process gap?",
    body: "High-volume CI notifications suggest either watch settings need adjusting (configuration) or the team hasn't established a clear CI triage protocol (process). Which is it, and who owns the fix?",
    tag: "Operations",
  },
];

export const recommendedActions: ReviewItem[] = [
  {
    title: "Close the integration gap with one real stack",
    body: "Identify one target integration — Okta, Jamf, or Microsoft Intune — and build a working proof-of-concept against a sandbox environment. This is the single action that most advances product credibility before any external conversation. Aim for a demo-able artifact within 30 days.",
    tag: "Priority 1",
  },
  {
    title: "Activate the outreach package with a defined send date",
    body: "Set a specific send date (not a range) for the first batch of outreach. Define a minimum viable response: one conversation booked counts as success. Review and iterate after the first 20 sends regardless of outcome.",
    tag: "Priority 1",
  },
  {
    title: "Suppress GitHub Actions notification noise",
    body: "Configure repository watch settings to notify only on direct mentions, failed runs, or security alerts. Alternatively, route CI notifications to a dedicated Slack channel or email filter. This is a 15-minute fix with disproportionate quality-of-life impact.",
    tag: "Priority 2",
  },
  {
    title: "Write one crisp objection-handling response",
    body: "Draft a 150-word response to the 'why not just extend our existing IAM/UEM' objection. Test it in a peer review. Refine it before it gets tested in a live prospect conversation.",
    tag: "Priority 2",
  },
  {
    title: "Define a 30/60/90-day activation plan with exit criteria",
    body: "Document: what success looks like at 30 days (first conversation booked), 60 days (one qualified pilot candidate identified), and 90 days (a working integration in a customer-adjacent environment). Assign an owner to each milestone.",
    tag: "Priority 2",
  },
  {
    title: "Conduct 5 customer discovery conversations before refining positioning",
    body: "The ICP and positioning language should be tested against actual buyers before the next revision. Five 20-minute conversations with operations or IT leaders in healthcare or logistics will surface objections, vocabulary mismatches, and unexpected use cases that no amount of internal iteration will reveal.",
    tag: "Priority 3",
  },
  {
    title: "Extend brand consistency to a one-pager and deck",
    body: "The landing page visual standard should be carried forward into a one-page product overview and a short investor/partner deck. These are the artifacts that circulate in email threads when you are not in the room.",
    tag: "Priority 3",
  },
];

export const dimensionReviews: DimensionReview[] = [
  {
    key: "product",
    label: "Product Readiness",
    score: 5,
    summary:
      "The product concept is technically coherent and the problem framing is defensible. The runtime decision layer model — evaluating identity, device posture, session context, and operational signals as a pre-condition for workflow continuity — is genuinely differentiated. The gap is between architectural clarity and validated integration.",
    observations: [
      "Core decision engine concept is well-articulated and technically credible",
      "Problem framing correctly targets shared-device and mobile frontline gap in existing Zero Trust stacks",
      "rc:smoke passing indicates build quality discipline",
      "No live integrations with identity providers, MDM, or workflow systems have been validated",
      "No reference to a pilot deployment, sandbox customer, or external test environment",
    ],
    gaps: [
      "No working integration against a real enterprise identity or device posture stack",
      "No external validation of the decision model against production signal data",
      "API surface and integration contract not publicly documented",
    ],
    actions: [
      "Build one proof-of-concept integration against Okta, Jamf, or Microsoft Intune in a sandbox environment",
      "Document the integration contract and signal schema for external review",
      "Define the minimum viable product scope for a first pilot deployment",
    ],
  },
  {
    key: "demo",
    label: "Demo Readiness",
    score: 7,
    summary:
      "The demo environment is functional and the smoke test pipeline is passing. This is ahead of most pre-seed projects. The remaining gap is narrative — a scripted, repeatable demo story that a non-technical founder can deliver consistently without improvisation.",
    observations: [
      "rc:smoke workflow is complete and verified passing",
      "Demo environment appears stable and controllable",
      "Build discipline is above average for this stage",
      "No evidence of a scripted demo narrative with defined decision points",
      "No mention of a recorded walkthrough or async demo artifact",
    ],
    gaps: [
      "No scripted demo narrative with clear before/after problem framing",
      "No async demo artifact (video walkthrough, interactive sandbox) for asynchronous review",
    ],
    actions: [
      "Write a 10-minute scripted demo narrative with explicit problem setup, decision trigger, and resolution",
      "Record one walkthrough video for async distribution",
      "Rehearse the demo with at least one external observer before the first live prospect meeting",
    ],
  },
  {
    key: "brand",
    label: "Brand & Visual Assets",
    score: 7,
    summary:
      "The visual identity and landing page represent a credible, above-baseline brand execution for a pre-revenue security project. The next step is extending that standard to the artifacts that actually circulate in enterprise conversations: one-pagers and decks.",
    observations: [
      "Landing page is live with defined visual identity",
      "Wordmark and color system appear consistent across reviewed materials",
      "Visual execution is above average for a pre-revenue B2B security project",
      "No one-pager or pitch deck at the same visual standard was referenced",
      "Brand guidelines document not mentioned",
    ],
    gaps: [
      "No one-page product overview for email distribution",
      "No pitch deck carrying the brand standard",
      "Brand guidelines not formalized for consistency as team grows",
    ],
    actions: [
      "Create a one-page product overview that can be attached to outreach emails",
      "Build a 10-slide deck covering problem, solution, differentiation, and next step",
      "Document core brand elements (color, type, logo usage) in a one-page brand guide",
    ],
  },
  {
    key: "outreach",
    label: "Launch Outreach",
    score: 5,
    summary:
      "An outreach package exists, which is progress. But an assembled package that has not been activated is functionally equivalent to no outreach. The gap is activation — a specific send date, a defined first-batch size, and a clear definition of what constitutes a successful response.",
    observations: [
      "Outreach package has been assembled and reviewed",
      "Target segment appears plausible based on product framing",
      "Package has not yet been sent or activated",
      "No reply rate data or qualified conversation count exists",
      "ICP definition has not been externally validated through discovery conversations",
    ],
    gaps: [
      "No activation sequence with dates, owners, and batch sizes",
      "No ICP validation through external customer discovery",
      "No qualification criteria for distinguishing a warm response from a polite decline",
    ],
    actions: [
      "Set a specific send date for the first batch — not a range, a date",
      "Define first-batch size (suggested: 20–30 sends) and response classification criteria",
      "Conduct 5 customer discovery conversations to stress-test ICP assumptions before scaling outreach",
    ],
  },
  {
    key: "github",
    label: "GitHub Hygiene",
    score: 8,
    summary:
      "Repo cleanup is complete, CI is passing, and the repository is in credible shape for external review. This is a genuine strength. The remaining deduction reflects the unresolved notification noise issue, which is an operational nuisance rather than a structural gap.",
    observations: [
      "Repo cleanup is confirmed complete",
      "rc:smoke CI workflow is passing",
      "Repository structure and README appear clean based on reported state",
      "GitHub Actions notification volume is a named, unresolved concern",
      "No mention of branch protection rules or contribution workflow documentation",
    ],
    gaps: [
      "GitHub Actions notification noise has not been resolved",
      "Branch protection and contribution workflow not mentioned",
    ],
    actions: [
      "Configure repository watch settings: notifications for direct mentions, failed runs, and security alerts only",
      "Route CI notifications to a dedicated channel or label-filtered view",
      "Verify branch protection rules are active on main",
    ],
  },
  {
    key: "workflow",
    label: "Workflow Automation Noise",
    score: 4,
    summary:
      "High-volume, low-signal GitHub Actions emails are a solvable operational issue that has not yet been solved. In a small-team or single-founder environment, this kind of ambient noise competes directly with strategic focus. It should be treated as a first-week fix, not a backlog item.",
    observations: [
      "GitHub Actions notification volume is explicitly named as a current concern",
      "Volume suggests watch settings are configured to notify on all run events",
      "This is a configuration issue, not a product or architecture issue",
      "Low severity, but non-trivial nuisance in a high-attention context",
    ],
    gaps: [
      "Repository watch settings have not been adjusted to filter notification frequency",
      "No triage protocol established for CI alerts",
    ],
    actions: [
      "Go to repository → Watch → Custom → uncheck 'Actions' or restrict to failed-only",
      "Alternatively: set up a GitHub Actions notification email filter at the inbox level",
      "Establish a weekly CI review cadence rather than real-time notification response",
    ],
  },
  {
    key: "positioning",
    label: "Market Positioning",
    score: 6,
    summary:
      "The positioning is specific, defensible, and correctly restrained. Shared-device and mobile frontline environments represent a genuine gap in the Zero Trust landscape. The 'not a replacement' framing is the right call. The remaining gap is the affirmative case: what exactly SignalGrid does better than extending existing stack components.",
    observations: [
      "Positioning as runtime decision layer for shared-device and frontline environments is specific and differentiated",
      "Conservative framing (not replacing IAM/UEM/SIEM/ITSM) protects credibility",
      "Zero Trust orchestration framing aligns with current enterprise security vocabulary",
      "Competitive differentiation from adjacent vendors is not yet fully articulated",
      "The 'why not just extend existing stack' objection is not addressed in current materials",
    ],
    gaps: [
      "No crisp response to the 'extend existing stack' objection",
      "Competitive landscape analysis not referenced",
      "Customer vocabulary alignment not validated through discovery",
    ],
    actions: [
      "Write one crisp 'why SignalGrid vs. existing stack extension' response (150 words)",
      "Map three adjacent vendors (suggest: Okta Device Trust, CrowdStrike Zero Trust Assessment, Microsoft Conditional Access) and articulate one specific gap each leaves in shared-device environments",
      "Test positioning language with 3 security practitioners before finalizing",
    ],
  },
];

export const overallScore = {
  value: 6.0,
  maxValue: 10,
  label: "Pre-Launch Readiness",
  interpretation:
    "SignalGrid is in a credible pre-launch position with above-average engineering and brand execution for this stage. The dominant gaps are on the go-to-market side: outreach has not been activated, the integration story is unvalidated, and the 30/60/90-day plan does not yet exist. None of these gaps are structural — they are execution items. The most important single action is activating outreach while simultaneously closing one integration proof point.",
};
