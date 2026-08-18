import { motion } from "framer-motion";

const VERTICALS = [
  {
    name: "Healthcare",
    badge: "HIGH PRIORITY",
    badgeColor: "text-teal-400 bg-teal-400/10 border-teal-400/20",
    useCase: "Medication cart iPads, EHR/MAR workflow access",
    detail:
      "Badge state gates MAR workflow access at evaluation time. If a cart leaves the floor without checkout, the decision recommends restrict with the evidence attached — the MDM remains the system that activates Lost Mode, and credential rotation stays with your identity stack.",
  },
  {
    name: "Warehousing & Logistics",
    badge: "HIGH PRIORITY",
    badgeColor: "text-teal-400 bg-teal-400/10 border-teal-400/20",
    useCase: "Shared Android scanners, high-value inventory authorization",
    detail:
      "Inventory write permissions gated to zone, shift, and device posture. BLE proximity confirms the worker is physically at the pick location before authorizing the transaction.",
  },
  {
    name: "Manufacturing",
    badge: "HIGH PRIORITY",
    badgeColor: "text-teal-400 bg-teal-400/10 border-teal-400/20",
    useCase: "Restricted floor access, production workflow gating",
    detail:
      "Contextual physical access to production areas, server rooms, and lab zones based on live assignment. Tamper detection prevents unauthorized device relocation between cells.",
  },
  {
    name: "Airports & Transit",
    badge: "STRONG FIT",
    badgeColor: "text-purple-400 bg-purple-400/10 border-purple-400/20",
    useCase: "Gate agent shared tablets, secure zone device accountability",
    detail:
      "Airside device custody tracking with dock-in accountability at shift end. Cellular fallback ensures device reachability even in areas with intermittent Wi-Fi coverage.",
  },
  {
    name: "Hospitality & Casinos",
    badge: "STRONG FIT",
    badgeColor: "text-purple-400 bg-purple-400/10 border-purple-400/20",
    useCase: "Floor devices, cage access, regulated workflow authorization",
    detail:
      "Transaction authorization gated to shift window, role, and physical zone. Compliance audit trail automatically captures every device custody handover for regulatory review.",
  },
  {
    name: "Clinical Labs & Pharma",
    badge: "STRONG FIT",
    badgeColor: "text-purple-400 bg-purple-400/10 border-purple-400/20",
    useCase: "Controlled substance access, chain-of-custody evidence",
    detail:
      "Pharmacy and controlled substance room access provisioned dynamically based on current shift assignment and current device posture — not a static role.",
  },
  {
    name: "Retail & POS",
    badge: "EMERGING",
    badgeColor: "text-amber-400 bg-amber-400/10 border-amber-400/20",
    useCase: "Shared POS terminals, register workflow gating",
    detail:
      "Inventory write workflows gated by posture. Posture and shift evidence gate the register workflow; kiosk mode itself stays an MDM/supervised-device control. Shift-scoped credentials prevent unauthorized register access.",
  },
  {
    name: "Government & Defense",
    badge: "EMERGING",
    badgeColor: "text-amber-400 bg-amber-400/10 border-amber-400/20",
    useCase: "Air-gapped deployments, classified workflow gating",
    detail:
      "On-premise decision engine with zero external data transmission. Physical presence required for all sensitive workflow access. Audit trail designed to map to FedRAMP and CMMC control expectations — a design target, not a certification held.",
  },
  {
    name: "Enterprise IT / SOC",
    badge: "EMERGING",
    badgeColor: "text-amber-400 bg-amber-400/10 border-amber-400/20",
    useCase: "Privileged engineering workstations, jump host access",
    detail:
      "Production environment access gated to device integrity, identity posture, and active shift authorization. Every privilege escalation is tied to a named identity with physical custody accountability.",
  },
];

export default function VerticalsSection() {
  return (
    <section className="py-24 bg-background border-b border-border/50" id="use-cases">
      <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
        <div className="mb-16">
          <h2 className="text-3xl font-bold tracking-tight mb-4">Built for Every Frontline Environment</h2>
          <p className="text-muted-foreground text-lg max-w-2xl">
            Anywhere workers share devices across shifts — and accountability matters — SignalGrid closes the gap between physical access control and digital identity. One decision layer for every frontline shift.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {VERTICALS.map((vertical, idx) => (
            <motion.div
              key={vertical.name}
              initial={{ opacity: 0, scale: 0.98 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: idx * 0.05 }}
              className="p-6 rounded-xl border border-border bg-card/50 hover:bg-card hover:border-border/80 transition-all cursor-default"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <h3 className="text-base font-semibold">{vertical.name}</h3>
                <span className={`shrink-0 text-xs font-mono px-2 py-0.5 rounded border ${vertical.badgeColor}`}>
                  {vertical.badge}
                </span>
              </div>
              <div className="text-primary text-xs font-medium mb-3 font-mono">{vertical.useCase}</div>
              <p className="text-sm text-muted-foreground leading-relaxed">{vertical.detail}</p>
            </motion.div>
          ))}
        </div>

        <p className="mx-auto mt-16 max-w-2xl text-center text-sm text-muted-foreground/70">
          Deterministic and fixture-backed today. Every high-risk action stays approval-gated and
          simulated — SignalGrid recommends and records; the PACS, MDM, and identity stack remain
          the systems that act.
        </p>
      </div>
    </section>
  );
}
