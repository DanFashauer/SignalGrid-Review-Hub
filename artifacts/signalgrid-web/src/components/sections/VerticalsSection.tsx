import { motion } from "framer-motion";

// Copy source: docs/POSITIONING.md + DR-012 (lean-IT segment). Every mechanism
// named here is a Limited-GA capability: device compliance, the freshness of
// that answer, and the device's authority to act right now. Deferred signal families appear NOWHERE on this
// page as current capability — the launch-claims gate enforces that.
const VERTICALS = [
  {
    name: "Warehousing & Logistics",
    badge: "FIRST TARGET",
    badgeColor: "text-teal-400 bg-teal-400/10 border-teal-400/20",
    useCase: "Shared Android scanners and station PCs, small IT team, many sites",
    detail:
      "Before an inventory write or high-value authorization, the host app asks one question: is this scanner compliant, is that answer current, and may it act right now? A device your management plane hasn't heard from in hours stops reading as trusted — it steps up or restricts, with the evidence attached for whoever owns the fix.",
  },
  {
    name: "Clinics & Outpatient",
    badge: "FIRST TARGET",
    badgeColor: "text-teal-400 bg-teal-400/10 border-teal-400/20",
    useCase: "Shared carts and tablets, compliance pressure, no security engineering team",
    detail:
      "Sensitive workflows check the device before proceeding — read-only, shadow-mode first, no clinical data touched. Domain safety stays in your clinical apps; SignalGrid answers only whether this device, in its current state, should proceed. Every verdict carries evidence an auditor can reproduce.",
  },
  {
    name: "Field Service & Facilities",
    badge: "FIRST TARGET",
    badgeColor: "text-teal-400 bg-teal-400/10 border-teal-400/20",
    useCase: "Trucks, depots, and handhelds that leave the building every day",
    detail:
      "A device that's been off the network all day comes back with a stale compliance story. SignalGrid treats staleness as a reason to tighten, never to assume — the workflow that matters gets a fresh answer or a step-up, not a shrug.",
  },
  {
    name: "Manufacturing",
    badge: "STRONG FIT",
    badgeColor: "text-purple-400 bg-purple-400/10 border-purple-400/20",
    useCase: "Shared terminals on the floor, production workflow gating",
    detail:
      "Production-system actions from shared floor terminals get the same one-question gate: compliant, current, authorized right now. Enforcement on the device itself stays your MDM's job on a supervised device — SignalGrid decides, your app applies.",
  },
  {
    name: "Hospitality & Retail",
    badge: "STRONG FIT",
    badgeColor: "text-purple-400 bg-purple-400/10 border-purple-400/20",
    useCase: "Shared POS and floor devices, franchise-scale IT",
    detail:
      "Register and back-office workflows gated by device state at the moment of action — not by who logged in this morning. Kiosk mode itself stays a supervised-device control; SignalGrid supplies the decision your POS applies.",
  },
  {
    name: "MSP-Managed SMB",
    badge: "CHANNEL",
    badgeColor: "text-amber-400 bg-amber-400/10 border-amber-400/20",
    useCase: "One MSP, many structurally similar lean-IT customers",
    detail:
      "SignalGrid reads the management plane the MSP already runs — proven live against Fleet — and gives every customer's shared devices the same defensible decision layer without adding a console anyone has to babysit.",
  },
];

export default function VerticalsSection() {
  return (
    <section className="py-24 bg-background border-b border-border/50" id="verticals">
      <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
        <div className="mb-16 max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight mb-4">Built for Teams With More Devices Than IT Staff</h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            SignalGrid&apos;s first market is the organization with 75–1,000 people, a handful of IT
            generalists, and a fleet of shared frontline devices doing real work. You keep the
            management plane you already run — SignalGrid turns its evidence, plus what the device
            can prove right now, into one defensible answer per sensitive action.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {VERTICALS.map((v, idx) => (
            <motion.div
              key={v.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: idx * 0.06 }}
              className="p-6 rounded-xl border border-border bg-card shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-foreground">{v.name}</h3>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border uppercase tracking-wider ${v.badgeColor}`}>
                  {v.badge}
                </span>
              </div>
              <p className="text-sm font-medium text-foreground/80 mb-3">{v.useCase}</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{v.detail}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
