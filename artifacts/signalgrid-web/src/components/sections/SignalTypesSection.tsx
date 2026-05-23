import { motion } from "framer-motion";
import { UserCircle, Shield, MapPin, Clock, Wifi, ActivitySquare } from "lucide-react";

export default function SignalTypesSection() {
  const signals = [
    {
      id: "identity",
      name: "Identity & Badge State",
      icon: UserCircle,
      items: [
        "IdP/SSO token + MFA state",
        "Badge physically inserted in case",
        "Imprivata tap-and-go session binding",
        "Passkey / FIDO2 verification",
      ],
      color: "text-blue-400",
      bg: "bg-blue-400/10",
      border: "border-blue-400/20",
    },
    {
      id: "device",
      name: "Device Posture",
      icon: Shield,
      items: [
        "MDM/UEM real-time compliance",
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
      name: "Physical Presence",
      icon: MapPin,
      items: [
        "Badge tap event — door / zone",
        "BLE/UWB indoor proximity zone",
        "PACS access log — current location",
        "Dock state — checked out or returned",
      ],
      color: "text-orange-400",
      bg: "bg-orange-400/10",
      border: "border-orange-400/20",
    },
    {
      id: "session",
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
      name: "Network & Cellular Posture",
      icon: Wifi,
      items: [
        "Enterprise Wi-Fi association state",
        "Cellular/eSIM reachability (post-exit)",
        "VPN / NAC / ISE trust level",
        "Network zone & VLAN classification",
      ],
      color: "text-cyan-400",
      bg: "bg-cyan-400/10",
      border: "border-cyan-400/20",
    },
    {
      id: "operational",
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
          <h2 className="text-3xl font-bold tracking-tight mb-4">Six-Dimensional Signal Fusion</h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            A token proves identity. MDM proves enrollment. A badge tap proves presence. None of them alone proves readiness for a sensitive workflow. SignalGrid fuses six signal dimensions — including physical custody state and cellular reachability — in a single sub-40ms evaluation.
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
              <div className={`w-10 h-10 rounded-lg ${signal.bg} flex items-center justify-center mb-5`}>
                <signal.icon className={`w-5 h-5 ${signal.color}`} />
              </div>
              <h3 className="text-base font-semibold mb-4 text-foreground">{signal.name}</h3>
              <ul className="space-y-2.5">
                {signal.items.map((item, i) => (
                  <li key={i} className="flex items-start text-sm text-muted-foreground">
                    <span className={`w-1.5 h-1.5 rounded-full ${signal.color} mr-2 mt-1.5 shrink-0 opacity-70`}></span>
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
