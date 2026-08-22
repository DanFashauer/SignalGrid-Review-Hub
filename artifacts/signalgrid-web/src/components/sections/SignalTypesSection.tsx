import { motion } from "framer-motion";
import { Shield, HeartPulse, KeyRound, Layers } from "lucide-react";

// Copy source: docs/POSITIONING.md (DR-011/DR-012). The three cards marked
// "Limited GA" are exactly the launch-profile's three launch signal kinds —
// the launch-claims gate fails this file if a deferred capability is ever
// presented as current again (that defect shipped once: six dimensions
// wore a current-capability label while three were deferred).
export default function SignalTypesSection() {
  const signals = [
    {
      id: "device-posture",
      limitedGA: true,
      name: "Device Compliance",
      icon: Shield,
      items: [
        "Read-only from your device-management source",
        "Proven live against Fleet — the management plane lean IT teams run",
        "Microsoft Intune adapter implemented and wire-hardened, awaiting a customer tenant",
        "Encryption, enrollment, compliance state",
      ],
      color: "text-green-400",
      bg: "bg-green-400/10",
      border: "border-green-400/20",
    },
    {
      id: "management-health",
      limitedGA: true,
      name: "Is That Answer Still Current?",
      icon: HeartPulse,
      items: [
        "How fresh the compliance answer really is",
        "A stale “compliant” is the unearned yes in its purest form",
        "Source unreachable or late → the decision tightens",
        "Every verdict records the observation age it acted on",
      ],
      color: "text-teal-400",
      bg: "bg-teal-400/10",
      border: "border-teal-400/20",
    },
    {
      id: "local-authority",
      limitedGA: true,
      name: "Can the Device Vouch for Itself Right Now?",
      icon: KeyRound,
      items: [
        "Whether the device may act on its own authority at this moment",
        "Missing or unverifiable → step up, restrict, or deny — never assume",
        "Evaluated per action, not per login",
        "Reproducible evidence attached to every verdict",
      ],
      color: "text-orange-400",
      bg: "bg-orange-400/10",
      border: "border-orange-400/20",
    },
  ];

  const beyondGA = [
    "Identity & session state", "Badge binding", "Physical custody & docks",
    "Security-baseline (CIS) alignment", "Shift & role context",
    "Network posture", "EDR & threat state", "Location & zones",
    "ITSM & operational context",
  ];

  return (
    <section className="py-24 bg-background border-b border-border/50" id="platform">
      <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
        <div className="mb-16 max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight mb-4">Three Signals, One Honest Answer</h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            At Limited GA the decision core evaluates <span className="text-foreground font-medium">exactly three things</span>:
            the device&apos;s compliance, how current that compliance answer really is, and whether the
            device can vouch for itself right now. Anything it can&apos;t verify{" "}
            <span className="text-foreground font-medium">tightens the answer instead of waving it through</span>.
            That narrowness is deliberate — every claim on this page traces to a proof that runs on every commit.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {signals.map((signal, idx) => (
            <motion.div
              key={signal.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: idx * 0.08 }}
              className={`p-6 rounded-xl border ${signal.border} bg-card shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group`}
            >
              <div className={`absolute top-0 right-0 w-32 h-32 -mr-8 -mt-8 rounded-full blur-3xl opacity-20 group-hover:opacity-30 transition-opacity ${signal.bg}`}></div>
              <div className="flex items-center justify-between mb-5">
                <div className={`w-10 h-10 rounded-lg ${signal.bg} flex items-center justify-center`}>
                  <signal.icon className={`w-5 h-5 ${signal.color}`} />
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border uppercase tracking-wider text-emerald-400 border-emerald-400/30 bg-emerald-400/5">
                  Limited GA
                </span>
              </div>
              <h3 className="text-base font-semibold mb-4 text-foreground">{signal.name}</h3>
              <ul className="space-y-2.5">
                {signal.items.map((item, i) => (
                  <li key={i} className="flex items-start text-sm text-muted-foreground">
                    <span className={`w-1.5 h-1.5 rounded-full bg-current ${signal.color} mr-2 mt-1.5 shrink-0 opacity-70`}></span>
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mt-10 p-6 rounded-xl border border-border bg-muted/20"
        >
          <div className="flex items-center gap-3 mb-3">
            <Layers className="w-5 h-5 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
              Beyond Limited GA — proven in the repository, not shipping yet
            </h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
            These signal families exist as working, gate-checked code in the public repository —
            and they are deliberately <span className="text-foreground">not</span> part of what we
            ship at Limited GA. They arrive when they can be proven against a customer&apos;s real
            environment, not before. We would rather show you three signals that are true than nine
            that are aspirational.
          </p>
          <div className="flex flex-wrap gap-2">
            {beyondGA.map((name) => (
              <span key={name} className="text-xs px-3 py-1 rounded-full border border-border bg-background text-muted-foreground">
                {name}
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
