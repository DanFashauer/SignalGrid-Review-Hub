import { motion } from "framer-motion";
import { UserCircle, Shield, Clock, ActivitySquare } from "lucide-react";

export default function SignalTypesSection() {
  const signals = [
    {
      id: "identity",
      name: "Identity State",
      icon: UserCircle,
      items: ["IdP/SSO token validation", "MFA temporal state", "Role & group assignment"],
      color: "text-blue-400",
      bg: "bg-blue-400/10",
      border: "border-blue-400/20"
    },
    {
      id: "device",
      name: "Device Posture",
      icon: Shield,
      items: ["MDM/UEM compliance state", "Encryption & patch level", "Jailbreak/root detection"],
      color: "text-purple-400",
      bg: "bg-purple-400/10",
      border: "border-purple-400/20"
    },
    {
      id: "session",
      name: "Session Context",
      icon: Clock,
      items: ["Shift window match", "Role-to-device assignment", "Time-of-access pattern"],
      color: "text-amber-400",
      bg: "bg-amber-400/10",
      border: "border-amber-400/20"
    },
    {
      id: "operational",
      name: "Operational Signals",
      icon: ActivitySquare,
      items: ["Real-time service health", "Kiosk mode state validation", "ITSM open security incidents"],
      color: "text-emerald-400",
      bg: "bg-emerald-400/10",
      border: "border-emerald-400/20"
    }
  ];

  return (
    <section className="py-24 bg-background border-b border-border/50" id="platform">
      <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
        <div className="mb-16 max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight mb-4">Four-Dimensional Signal Evaluation</h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            A token proves identity. MDM proves enrollment. Neither proves readiness for a sensitive workflow. SignalGrid fuses four signal dimensions in real-time.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {signals.map((signal, idx) => (
            <motion.div
              key={signal.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: idx * 0.1 }}
              className={`p-6 rounded-xl border ${signal.border} bg-card shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group`}
            >
              <div className={`absolute top-0 right-0 w-32 h-32 -mr-8 -mt-8 rounded-full blur-3xl opacity-20 group-hover:opacity-30 transition-opacity ${signal.bg}`}></div>
              <div className={`w-12 h-12 rounded-lg ${signal.bg} flex items-center justify-center mb-6`}>
                <signal.icon className={`w-6 h-6 ${signal.color}`} />
              </div>
              <h3 className="text-xl font-semibold mb-4 text-foreground">{signal.name}</h3>
              <ul className="space-y-3">
                {signal.items.map((item, i) => (
                  <li key={i} className="flex items-start text-sm text-muted-foreground">
                    <span className={`w-1.5 h-1.5 rounded-full ${signal.bg.replace('/10', '')} mr-2 mt-1.5 shrink-0`}></span>
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
