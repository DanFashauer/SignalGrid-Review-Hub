import { motion } from "framer-motion";
import { LogIn, Activity, LogOut } from "lucide-react";

const PHASES = [
  {
    icon: LogIn,
    phase: "Start of Shift",
    time: "07:00:00",
    color: "text-teal-400",
    border: "border-teal-400/20",
    bg: "bg-teal-400/10",
    steps: [
      "Employee taps badge at smart dock",
      "SignalGrid validates schedule, role, training, and location permissions",
      "Dock unlocks assigned device",
      "Badge mechanically locks into device case",
      "Session activates with shift-scoped app credentials",
      "Floor, elevator, and specialty area access provisioned",
    ],
  },
  {
    icon: Activity,
    phase: "During Shift",
    time: "CONTINUOUS",
    color: "text-emerald-400",
    border: "border-emerald-400/20",
    bg: "bg-emerald-400/10",
    steps: [
      "Badge presence confirmed in case",
      "BLE/UWB proximity — device in authorized zone",
      "Device posture re-evaluated at each workflow trigger",
      "Specialty access dynamically granted (ICU, pharmacy, lab)",
      "Idle timeout and tamper alerts monitored in real time",
      "Cellular/eSIM reachability confirmed for off-network resilience",
    ],
  },
  {
    icon: LogOut,
    phase: "End of Shift",
    time: "19:00:00",
    color: "text-orange-400",
    border: "border-orange-400/20",
    bg: "bg-orange-400/10",
    steps: [
      "Device docked — integrity check runs automatically",
      "Sessions ended, credentials revoked",
      "Audit log synced to ServiceNow / Splunk",
      "Badge released from mechanical lock",
      "Device queued for compliance re-baseline and charging",
      "If not returned: PagerDuty alert + MDM Lost Mode + location escalation",
    ],
  },
];

export default function OutcomesSection() {
  return (
    <section className="py-24 bg-zinc-950 border-b border-border/50 relative overflow-hidden">

      <div className="container mx-auto px-4 md:px-8 max-w-screen-xl relative z-10">
        <div className="mb-16 max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight mb-4">The Complete Shift Lifecycle</h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            SignalGrid orchestrates device custody from dock-out to dock-in. The smart dock becomes the identity broker, the physical lock creates accountability, and the decision engine maintains trust state continuously across the entire shift.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PHASES.map((phase, idx) => (
            <motion.div
              key={phase.phase}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: idx * 0.12 }}
              className={`rounded-xl border ${phase.border} bg-card p-6 relative overflow-hidden`}
            >
              <div className={`absolute top-0 right-0 w-40 h-40 -mr-10 -mt-10 rounded-full blur-3xl opacity-10 ${phase.bg}`}></div>
              <div className="flex items-center gap-3 mb-5">
                <div className={`w-9 h-9 rounded-lg ${phase.bg} flex items-center justify-center`}>
                  <phase.icon className={`w-5 h-5 ${phase.color}`} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">{phase.phase}</div>
                  <div className={`text-xs font-mono ${phase.color}`}>{phase.time}</div>
                </div>
              </div>

              <ul className="space-y-3">
                {phase.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className={`text-xs font-mono ${phase.color} w-5 shrink-0 mt-0.5`}>{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-sm text-muted-foreground leading-snug">{step}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-8 rounded-xl border border-destructive/20 bg-destructive/5 p-6"
        >
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="shrink-0">
              <div className="text-xs font-mono text-destructive mb-1">EXIT VIOLATION SCENARIO</div>
              <div className="text-sm font-semibold text-foreground">Device not docked by end of shift — no badge checkout recorded</div>
            </div>
            <div className="md:ml-auto flex flex-wrap gap-2">
              {[
                "PagerDuty incident created",
                "Supervisor notified",
                "MDM Lost Mode triggered",
                "Cellular tracking escalated",
                "Badge access suspended",
              ].map((action) => (
                <span key={action} className="inline-flex items-center rounded-md border border-destructive/20 bg-destructive/10 px-2.5 py-1 text-xs font-mono text-destructive">
                  {action}
                </span>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
