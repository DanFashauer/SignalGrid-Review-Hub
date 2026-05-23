import { motion } from "framer-motion";
import { Link2, MapPinned, ClipboardList, Radio, Layers } from "lucide-react";

const DIFFERENTIATORS = [
  {
    icon: Link2,
    title: "Physical Custody Binding",
    description:
      "The employee badge mechanically locks into the device case. The device cannot be fully used without the badge present. The badge cannot be removed without triggering an alert. Identity and custody are physically inseparable.",
    before: "Badge system: separate",
    after: "Badge = device key",
  },
  {
    icon: MapPinned,
    title: "Contextual Physical Access",
    description:
      "Floor access, elevator permissions, ICU access, pharmacy, lab, and server room authorizations are granted dynamically based on current assignment, current device, current shift, and live posture — not a static role list.",
    before: "Static RBAC list",
    after: "Runtime zone authorization",
  },
  {
    icon: ClipboardList,
    title: "Chain of Custody Enforcement",
    description:
      "Every device has a timestamped owner at every moment of the shift. Dock-out, zone transitions, workflow access, and dock-in are all audited as a continuous custody chain. Compliance is a byproduct, not a reporting task.",
    before: "Asset spreadsheet",
    after: "Continuous custody audit",
  },
  {
    icon: Radio,
    title: "Pre-Exit Prevention + Post-Exit Recovery",
    description:
      "BLE proximity, badge checkout state, and door events prevent unauthorized exits before they happen. When a Wi-Fi-only device goes dark, cellular/eSIM APIs (Twilio, Soracom, Hologram) maintain a recovery channel.",
    before: "Gone = lost",
    after: "Pre-exit + post-exit coverage",
  },
  {
    icon: Layers,
    title: "Additive — Nothing Replaced",
    description:
      "SignalGrid sits above your existing Intune, Okta, HID, Imprivata, CrowdStrike, and ServiceNow investments. It doesn't replace any of them — it fuses their signals into one runtime context that none of them can produce alone.",
    before: "122+ siloed vendors",
    after: "One decision layer",
  },
];

export default function DifferentiatorsSection() {
  return (
    <section className="py-24 bg-background border-b border-border/50">
      <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold tracking-tight mb-4">Nobody Owns This Gap. Yet.</h2>
          <p className="text-muted-foreground text-lg">
            Imprivata owns tap-and-go. HID owns badge credentials. Jamf owns device trust. ServiceNow owns tickets. Nobody owns the layer that binds them all into physical accountability at workflow time. That's SignalGrid.
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
      </div>
    </section>
  );
}
