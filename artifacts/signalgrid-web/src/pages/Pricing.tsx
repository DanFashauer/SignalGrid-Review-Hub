import { motion } from "framer-motion";
import { CheckCircle2, X } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

const TIERS = [
  {
    name: "Starter",
    price: "$8",
    unit: "per device / month",
    desc: "For lean IT teams starting with a 30\u201345-day shadow-mode pilot on shared devices.",
    highlight: false,
    cta: "Request a walkthrough",
    features: [
      { text: "Device counts indicative — the measured constraint is the per-key rate limit (240 requests/minute default, operator-tunable)", ok: true },
      { text: "The three Limited GA signals: device compliance, its freshness, and the device's authority to act now", ok: true },
      { text: "Decision engine + policy editor", ok: true },
      { text: "Operator dashboard", ok: true },
      { text: "Mobile PWA (operator + access-support triage)", ok: true },
      { text: "Tamper-evident audit ledger — hash-chained and independently verifiable", ok: true },
      { text: "Shift Handoff Intelligence", ok: false },
      { text: "Compliance reporting export", ok: false },
      { text: "Custom alert routing", ok: false },
      { text: "Air-gap / on-premise deploy", ok: false },
    ],
  },
  {
    name: "Enterprise",
    price: "$14",
    unit: "per device / month",
    desc: "For larger frontline fleets across multiple facilities — same lean-IT-first product, more devices.",
    highlight: true,
    cta: "Request a walkthrough",
    features: [
      { text: "Device counts indicative — the measured constraint is the per-key rate limit (240 requests/minute default, operator-tunable)", ok: true },
      { text: "16 candidate source categories", ok: true },
      { text: "Decision engine + policy editor", ok: true },
      { text: "Operator dashboard + Desktop client", ok: true },
      { text: "Mobile PWA (operator + access-support triage)", ok: true },
      { text: "Tamper-evident audit ledger — hash-chained and independently verifiable", ok: true },
      { text: "Shift Handoff Intelligence", ok: true },
      { text: "Compliance reporting export", ok: true },
      { text: "Ownership-aware alert routing", ok: true },
      { text: "Cloud or self-hosted VPC", ok: true },
    ],
  },
  {
    name: "Federal / DoD",
    price: "Custom",
    unit: "contact for a conversation",
    desc: "Air-gap-oriented, STIG-oriented, FedRAMP-path, CMMC-L3-mapped deployment design for government and defense (pre-announcement).",
    highlight: false,
    cta: "Request a conversation",
    features: [
      { text: "Air-gap-oriented deployment", ok: true },
      { text: "DISA STIG-oriented base image", ok: true },
      { text: "FedRAMP-path (roadmap)", ok: true },
      { text: "DoD IL2–IL5-oriented architecture", ok: true },
      { text: "CMMC 2.0 Level 3 mapping", ok: true },
      { text: "ITAR / EAR-aware design", ok: true },
      { text: "Classified-network design", ok: true },
      { text: "Professional-services design path", ok: true },
      { text: "Offline license model", ok: true },
      { text: "SCAP / XCCDF benchmark mapping", ok: true },
      { text: "Design-partner engagement", ok: true },
    ],
  },
];

const FAQ = [
  {
    q: "What counts as a 'managed device'?",
    a: "Any shared device registered to a SignalGrid policy — typically a tablet, mobile computer, or terminal that is physically custody-bound to a badge case and evaluated at each workflow trigger.",
  },
  {
    q: "Is the badge reader case included in the price?",
    a: "The dock and reader case are a pre-production design concept; no hardware is for sale or lease today. Any future hardware would be priced separately from the software.",
  },
  {
    q: "Can we start with cloud and move to self-hosted?",
    a: "That is the design: policies and audit exports are portable by design, so nothing about the model locks you into one deployment. Migration tooling is not built yet.",
  },
  {
    q: "What does the FedRAMP path mean?",
    a: "FedRAMP authorization is a roadmap target that would require a separate, formal process — it is not claimed today. The air-gap Federal/DoD deployment is a design modeled on public-safe fixtures, not an available offering.",
  },
  {
    q: "Do you support Zebra and other rugged Android devices?",
    a: "Rugged-Android management tools (e.g. Zebra StageNow/OEMConfig/DataWedge, SOTI, 42Gears, Honeywell, Datalogic) are candidate signal-source categories in the design. They are not live integrations today; any live integration would require separate private validation.",
  },
];

export default function Pricing() {
  return (
    <div className="dark min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />
      <main className="flex-1">

        <section className="py-24 border-b border-border/50">
          <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
            <div className="text-center mb-16 max-w-2xl mx-auto">
              <h1 className="text-4xl font-bold tracking-tight mb-4">Indicative Pricing. No Per-Workflow Tax.</h1>
              <p className="text-muted-foreground text-lg">Illustrative per-device pricing that would scale with your fleet — not your decision volume. Pre-announcement: figures are indicative and not a live offer.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
              {TIERS.map((tier, idx) => (
                <motion.div
                  key={tier.name}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.1 }}
                  className={`relative rounded-xl border p-8 flex flex-col ${
                    tier.highlight
                      ? "border-primary shadow-[0_0_40px_-10px_rgba(79,140,135,0.35)] bg-primary/5"
                      : "border-border bg-card"
                  }`}
                >
                  <div className="mb-6">
                    <div className="text-xs font-mono text-muted-foreground mb-2 uppercase tracking-wide">{tier.name}</div>
                    <div className="flex items-baseline gap-1 mb-1">
                      <span className="text-4xl font-bold font-mono">{tier.price}</span>
                      {tier.price !== "Custom" && <span className="text-sm text-muted-foreground">/mo</span>}
                    </div>
                    <div className="text-xs font-mono text-muted-foreground">{tier.unit}</div>
                    <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{tier.desc}</p>
                  </div>

                  <ul className="space-y-2.5 mb-8 flex-1">
                    {tier.features.map(f => (
                      <li key={f.text} className={`flex items-start gap-2.5 text-sm ${f.ok ? "text-foreground/80" : "text-muted-foreground/70 line-through decoration-muted-foreground/40"}`}>
                        {f.ok
                          ? <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          : <X className="w-4 h-4 shrink-0 mt-0.5" />
                        }
                        {f.text}
                      </li>
                    ))}
                  </ul>

                  <a
                    href="https://github.com/DanFashauer/SignalGrid-Review-Hub"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`block text-center w-full py-2.5 rounded-md text-sm font-medium transition-colors ${
                    tier.highlight
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  }`}>
                    {tier.cta}
                  </a>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="container mx-auto px-4 md:px-8 max-w-3xl">
            <h2 className="text-2xl font-bold tracking-tight mb-10">Frequently Asked Questions</h2>
            <div className="space-y-6">
              {FAQ.map(faq => (
                <div key={faq.q} className="border-b border-border pb-6">
                  <h3 className="font-semibold mb-2">{faq.q}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

      </main>
      <Footer />
    </div>
  );
}
