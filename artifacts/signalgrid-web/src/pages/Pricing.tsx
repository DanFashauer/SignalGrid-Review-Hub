import { motion } from "framer-motion";
import { CheckCircle2, X } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

const TIERS = [
  {
    name: "Starter",
    price: "$8",
    unit: "per device / month",
    desc: "For teams piloting Zero Trust on shared devices. Up to 250 managed devices.",
    highlight: false,
    cta: "Start Free Trial",
    features: [
      { text: "Up to 250 managed devices", ok: true },
      { text: "5 integration sources", ok: true },
      { text: "Decision engine + policy editor", ok: true },
      { text: "Operator dashboard", ok: true },
      { text: "Mobile PWA", ok: true },
      { text: "7-day audit log retention", ok: true },
      { text: "Email support", ok: true },
      { text: "Shift Handoff Intelligence", ok: false },
      { text: "Compliance reporting export", ok: false },
      { text: "Custom alert routing", ok: false },
      { text: "Air-gap / on-premise deploy", ok: false },
      { text: "SLA guarantee", ok: false },
    ],
  },
  {
    name: "Enterprise",
    price: "$14",
    unit: "per device / month",
    desc: "For enterprise security teams managing large frontline device fleets across facilities.",
    highlight: true,
    cta: "Contact Sales",
    features: [
      { text: "Unlimited managed devices", ok: true },
      { text: "140+ integration sources", ok: true },
      { text: "Decision engine + policy editor", ok: true },
      { text: "Operator dashboard + Desktop client", ok: true },
      { text: "Mobile PWA + Zebra native build", ok: true },
      { text: "1-year immutable audit log", ok: true },
      { text: "24/7 dedicated support + SRE", ok: true },
      { text: "Shift Handoff Intelligence", ok: true },
      { text: "Compliance reporting export", ok: true },
      { text: "Ownership-aware alert routing", ok: true },
      { text: "Cloud or self-hosted VPC", ok: true },
      { text: "99.99% uptime SLA", ok: true },
    ],
  },
  {
    name: "Federal / DoD",
    price: "Custom",
    unit: "contact for pricing",
    desc: "Air-gapped, DISA STIG hardened, FedRAMP-path, CMMC L3 certified deployments for government and defense.",
    highlight: false,
    cta: "Contact Sales",
    features: [
      { text: "Unlimited managed devices", ok: true },
      { text: "Air-gapped deployment", ok: true },
      { text: "DISA STIG hardened base image", ok: true },
      { text: "FedRAMP authorization path", ok: true },
      { text: "DoD IL2–IL5 architecture", ok: true },
      { text: "CMMC 2.0 Level 3", ok: true },
      { text: "ITAR / EAR compliance", ok: true },
      { text: "Classified network deployment", ok: true },
      { text: "On-site professional services", ok: true },
      { text: "Offline license model", ok: true },
      { text: "SCAP / XCCDF benchmark included", ok: true },
      { text: "Dedicated mission team", ok: true },
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
    a: "Hardware is priced separately. Device-as-a-Service (DaaS) leasing options are available for enterprise customers. Contact sales for hardware bundling.",
  },
  {
    q: "Can we start with cloud and move to self-hosted?",
    a: "Yes. Your policies, audit logs, and integration configurations are portable. Migration tooling is included for enterprise customers.",
  },
  {
    q: "What does the FedRAMP path mean?",
    a: "SignalGrid is pursuing FedRAMP Moderate authorization. Air-gapped Federal/DoD deployments are available now and include a full ATO support package with DISA STIG hardening documentation.",
  },
  {
    q: "Do you support Zebra and other rugged Android devices?",
    a: "Yes. SignalGrid has native integrations for Zebra StageNow/OEMConfig, DNA Cloud, LifeGuard Analytics, and DataWedge. SOTI MobiControl, 42Gears, Honeywell, and Datalogic are also supported.",
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
              <h1 className="text-4xl font-bold tracking-tight mb-4">Transparent Pricing. No Per-Workflow Tax.</h1>
              <p className="text-muted-foreground text-lg">Per-device pricing that scales with your fleet — not your decision volume. No charge per API call.</p>
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
                      ? "border-primary shadow-[0_0_40px_-10px_rgba(59,130,246,0.3)] bg-primary/5"
                      : "border-border bg-card"
                  }`}
                >
                  {tier.highlight && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-primary text-primary-foreground text-xs font-bold tracking-wider rounded-full uppercase">
                      Most Popular
                    </div>
                  )}
                  <div className="mb-6">
                    <div className="text-xs font-mono text-muted-foreground mb-2 uppercase tracking-widest">{tier.name}</div>
                    <div className="flex items-baseline gap-1 mb-1">
                      <span className="text-4xl font-bold font-mono">{tier.price}</span>
                      {tier.price !== "Custom" && <span className="text-sm text-muted-foreground">/mo</span>}
                    </div>
                    <div className="text-xs font-mono text-muted-foreground">{tier.unit}</div>
                    <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{tier.desc}</p>
                  </div>

                  <ul className="space-y-2.5 mb-8 flex-1">
                    {tier.features.map(f => (
                      <li key={f.text} className={`flex items-start gap-2.5 text-sm ${f.ok ? "text-foreground/80" : "text-muted-foreground/40"}`}>
                        {f.ok
                          ? <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          : <X className="w-4 h-4 shrink-0 mt-0.5" />
                        }
                        {f.text}
                      </li>
                    ))}
                  </ul>

                  <button className={`w-full py-2.5 rounded-md text-sm font-medium transition-colors ${
                    tier.highlight
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  }`}>
                    {tier.cta}
                  </button>
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
