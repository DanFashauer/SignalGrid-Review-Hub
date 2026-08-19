import { motion } from "framer-motion";
import { UserCircle, Shield, ShieldCheck, MapPin, Clock, Wifi, ActivitySquare } from "lucide-react";

export default function SignalTypesSection() {
  const signals = [
    {
      id: "identity",
      evaluated: true,
      name: "Identity State",
      icon: UserCircle,
      items: [
        "IdP/SSO token + MFA state",
        "Account enabled / disabled / unknown",
        "Tap-and-go session binding",
        "Passkey / FIDO2 verification",
      ],
      color: "text-teal-400",
      bg: "bg-teal-400/10",
      border: "border-teal-400/20",
    },
    {
      id: "device",
      evaluated: true,
      name: "Device Posture",
      icon: Shield,
      items: [
        "MDM/UEM compliance state",
        "EDR agent health & threat score",
        "Encryption, patch, jailbreak state",
        "Tamper sensor — forced badge removal",
      ],
      color: "text-green-400",
      bg: "bg-green-400/10",
      border: "border-green-400/20",
    },
    {
      id: "physical",
      evaluated: true,
      name: "Physical Presence",
      icon: MapPin,
      items: [
        "DockBridge custody — checked out / overdue / returned",
        "SmartDock hardware state — faulted / offline",
        "Battery / charge state from the dock",
        "Tamper witness — sensor present / blinded",
      ],
      color: "text-orange-400",
      bg: "bg-orange-400/10",
      border: "border-orange-400/20",
    },
    {
      id: "baseline",
      evaluated: true,
      name: "Security Baseline (CIS)",
      icon: ShieldCheck,
      items: [
        "CIS Benchmark alignment (aligned / drifted)",
        "CIS Controls v8 safeguard coverage",
        "DISA STIG / SCAP finding state",
        "Hardening drift → step-up or restrict",
      ],
      color: "text-emerald-400",
      bg: "bg-emerald-400/10",
      border: "border-emerald-400/20",
    },
    {
      id: "badge",
      evaluated: true,
      name: "Badge Binding (reader case)",
      icon: ShieldCheck,
      items: [
        "Badge present / removed / forced in the case",
        "Person → shared-device binding, live",
        "Withdrawn badge → restrict the session",
        "Forced / torn removal → deny",
      ],
      color: "text-amber-400",
      bg: "bg-amber-400/10",
      border: "border-amber-400/20",
    },
    {
      id: "session",
      evaluated: true,
      name: "Session & Shift Context",
      icon: Clock,
      items: [
        "Shift window & role match",
        "Device-to-worker assignment",
        "Specialty area authorization (ICU, pharmacy)",
        "Time-of-access pattern baseline",
      ],
      color: "text-purple-400",
      bg: "bg-purple-400/10",
      border: "border-purple-400/20",
    },
    {
      id: "network",
      evaluated: false,
      name: "Network & Cellular Posture",
      icon: Wifi,
      items: [
        "Enterprise Wi-Fi association state",
        "Cellular/eSIM reachability (post-exit)",
        "VPN / NAC / ISE trust level",
        "Network zone & VLAN classification",
      ],
      color: "text-teal-400",
      bg: "bg-teal-400/10",
      border: "border-teal-400/20",
    },
    {
      id: "operational",
      evaluated: false,
      name: "Operational Signals",
      icon: ActivitySquare,
      items: [
        "ITSM open incident context",
        "SIEM / SOAR alert state",
        "Infrastructure health from Datadog/Grafana",
        "PagerDuty escalation level",
      ],
      color: "text-amber-400",
      bg: "bg-amber-400/10",
      border: "border-amber-400/20",
    },
  ];

  return (
    <section className="py-24 bg-background border-b border-border/50" id="platform">
      <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
        <div className="mb-16 max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight mb-4">Multi-Dimensional Signal Fusion</h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            A token proves identity. MDM proves enrollment. A badge tap proves presence. None of them alone proves readiness for a sensitive workflow. The deterministic core evaluates <span className="text-foreground font-medium">six dimensions today</span> — identity, device posture, DockBridge physical custody, CIS security-baseline alignment, badge binding from the reader case, and session &amp; shift context — in a single deterministic evaluation. The remaining dimensions below are <span className="text-foreground font-medium">candidate signal categories</span> on the roadmap, not decision inputs today.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full border uppercase tracking-wider ${
                    signal.evaluated
                      ? "text-emerald-400 border-emerald-400/30 bg-emerald-400/5"
                      : "text-muted-foreground border-border bg-muted/20"
                  }`}
                >
                  {signal.evaluated ? "Evaluated today" : "Candidate"}
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
      </div>
    </section>
  );
}
