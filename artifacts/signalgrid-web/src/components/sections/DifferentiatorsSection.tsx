import { motion } from "framer-motion";
import { Link2, MapPinned, ClipboardList, Radio, Layers } from "lucide-react";

const DIFFERENTIATORS = [
  {
    icon: Link2,
    title: "Freshness Is a First-Class Signal",
    description:
      "Every management console can tell you the last state it recorded. SignalGrid treats HOW OLD that answer is as a decision input in its own right — a stale \u201ccompliant\u201d is the unearned yes in its purest form, and here it tightens the verdict instead of passing as green.",
    before: "\u201cCompliant\u201d (as of… when?)",
    after: "Compliant, current, verified now",
  },
  {
    icon: MapPinned,
    title: "Fail-Closed by Doctrine, Not by Default Config",
    description:
      "Missing, unknown, or contradictory evidence RAISES the assurance required — mechanically, proven by gates that run on every commit. There is no configuration in which absence reads as fine.",
    before: "Absent signal = assumed OK",
    after: "Absent signal = tighter answer",
  },
  {
    icon: ClipboardList,
    title: "Every Verdict Carries Its Evidence",
    description:
      "Each allow, step-up, restrict, or deny records what was observed, from which source, at what age, under which policy version — in a tamper-evident ledger an operator can replay without reading code.",
    before: "\u201cThe system said no\u201d",
    after: "Here is exactly why, and who fixes it",
  },
  {
    icon: Radio,
    title: "Invisible to Workers, Legible to Auditors",
    description:
      "Workers use the apps they already know; SignalGrid has no end-user surface at all. The people who DO see it — operators and auditors — get reproducible evidence instead of dashboards.",
    before: "Another console to babysit",
    after: "No new surface for workers at all",
  },
  {
    icon: Layers,
    title: "Additive — Nothing Replaced",
    description:
      "SignalGrid reads from the management plane you already run — proven live against Fleet, with Microsoft Intune as the enterprise connector on the roadmap — and replaces none of it. Your MDM stays your MDM; your IdP stays your IdP. Badge, custody, and zone signals are deferred roadmap categories, not Limited GA.",
    before: "Rip-and-replace platform",
    after: "One decision layer on your stack",
  },
];

export default function DifferentiatorsSection() {
  return (
    <section className="py-24 bg-background border-b border-border/50">
      <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold tracking-tight mb-4">Nobody Owns This Gap. Yet.</h2>
          <p className="text-muted-foreground text-lg">
            Your MDM knows what it last recorded. Your IdP knows who logged in. Nobody owns the question that actually matters on a shared device: should THIS action proceed RIGHT NOW? That's SignalGrid.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {DIFFERENTIATORS.slice(0, 3).map((d, idx) => (
            <motion.div
              key={d.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: idx * 0.1 }}
              className="p-8 rounded-xl border border-border bg-card relative overflow-hidden group"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary/3 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <d.icon className="w-8 h-8 text-primary mb-6" />
              <h3 className="text-lg font-semibold mb-3">{d.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed mb-6">{d.description}</p>
              <div className="pt-5 border-t border-border/50 space-y-1">
                <div className="text-xs font-mono text-muted-foreground line-through opacity-50">{d.before}</div>
                <div className="text-xs font-mono text-primary font-medium">{d.after}</div>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          {DIFFERENTIATORS.slice(3).map((d, idx) => (
            <motion.div
              key={d.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: idx * 0.1 }}
              className="p-8 rounded-xl border border-border bg-card relative overflow-hidden group"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary/3 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <d.icon className="w-8 h-8 text-primary mb-6" />
              <h3 className="text-lg font-semibold mb-3">{d.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed mb-6">{d.description}</p>
              <div className="pt-5 border-t border-border/50 space-y-1">
                <div className="text-xs font-mono text-muted-foreground line-through opacity-50">{d.before}</div>
                <div className="text-xs font-mono text-primary font-medium">{d.after}</div>
              </div>
            </motion.div>
          ))}
        </div>

        <p className="mx-auto mt-16 max-w-2xl text-center text-sm text-muted-foreground/70">
          Deterministic and fixture-backed today. SignalGrid recommends and records; the systems
          named here stay the systems of record, and every high-risk action stays approval-gated
          and simulated.
        </p>
      </div>
    </section>
  );
}
