import { motion } from "framer-motion";
import { Shield, Wifi, Battery, Cpu, Radio, Lock, AlertTriangle } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

const REPO = "https://github.com/DanFashauer/SignalGrid-Review-Hub";

// The dedicated SmartDock: an OPTIONAL embedded smart-charging dock. Power +
// network in; every decision runs in your own deployment. Design concept.
const SMARTDOCK = [
  {
    title: "Power + network in, nothing else required",
    body: "The dock takes power and a network uplink. The embedded SignalGrid agent streams normalized custody/charge/tamper/dock/badge signals — every ALLOW / STEP-UP / RESTRICT / DENY decision runs in your own deployment. The dock supplies signals and never decides.",
    icon: Wifi,
    color: "text-teal-400",
  },
  {
    title: "Smart charging as a decision signal",
    body: "Charge state and battery health are separate signals, because charging fixes one and not the other. A critically low battery steps up and clears once the device charges. A failing battery restricts — and deliberately cannot be cleared by re-docking, because the device needs a battery, not a bay.",
    icon: Battery,
    color: "text-orange-400",
  },
  {
    title: "Custody + badge binding at the bay",
    body: "The reader case in the dock asserts the person→shared-device binding continuously. A badge pulled restricts the live session; a forced removal denies. The dock is the tamper witness for the device it holds.",
    icon: Lock,
    color: "text-amber-400",
  },
  {
    title: "The dock reports its own health",
    body: "A faulted dock can't vouch for custody, so the session is restricted; an offline dock has lost its live channel, so access steps up. The dock's own state is part of the decision — not silently ignored.",
    icon: AlertTriangle,
    color: "text-red-400",
  },
];

const SPECS = [
  { category: "Form Factor", items: [
    { label: "Dimensions", value: "180 × 92 × 18 mm" },
    { label: "Weight", value: "312 g (with device + badge)" },
    { label: "IP Rating", value: "IP54 splash/dust resistant" },
    { label: "Drop Spec", value: "1.2 m drop per MIL-STD-810H" },
    { label: "Badge Slot", value: "ISO 7816 / 125kHz / 13.56MHz" },
  ]},
  { category: "Connectivity", items: [
    { label: "BLE", value: "BLE 5.3 · Long Range · AoA/AoD" },
    { label: "UWB", value: "IEEE 802.15.4a · ±10 cm accuracy" },
    { label: "Wi-Fi", value: "802.11ax (Wi-Fi 6) · 2.4 & 5 GHz" },
    { label: "eSIM", value: "GSMA SGP.22 · CAT-M1/NB-IoT/LTE" },
    { label: "USB", value: "USB-C 3.2 · Data + Charging" },
  ]},
  { category: "Security", items: [
    { label: "Secure Element", value: "EAL5+-class SE (design target)" },
    { label: "Crypto", value: "FIPS 140-2 L2 (design target)" },
    { label: "Attestation", value: "TPM 2.0 + device certificate" },
    { label: "Badge Lock", value: "Electromagnetic + solenoid latch" },
    { label: "Tamper", value: "Physical tamper detection + wipe" },
  ]},
  { category: "Power", items: [
    { label: "Battery", value: "4,800 mAh Li-Po" },
    { label: "Runtime", value: "12h+ typical shift operation" },
    { label: "Charging", value: "18W PD · Qi wireless (optional)" },
    { label: "Dock Power", value: "PoE+ dock or USB-C" },
    { label: "Standby", value: "7 days eSIM keepalive mode" },
  ]},
];

const DETECTION_PHASES = [
  {
    phase: "01",
    title: "Continuous Presence",
    color: "text-primary border-primary/20 bg-primary/5",
    signals: ["BLE zone heartbeat every 4 seconds", "UWB proximity binding (≤1 m)", "Badge electrical continuity check", "Dock occupancy sensor"],
    outcome: "Nominal — access continues",
    outcomeColor: "text-green-400",
  },
  {
    phase: "02",
    title: "Pre-Exit Detection",
    color: "text-amber-400 border-amber-400/20 bg-amber-400/5",
    signals: ["BLE RSSI degradation > threshold", "UWB zone boundary crossing", "Door contact event in PACS log", "Badge removal tension spike"],
    outcome: "WARN — step-up MFA triggered",
    outcomeColor: "text-amber-400",
  },
  {
    phase: "03",
    title: "Custody Violation",
    color: "text-red-400 border-red-400/20 bg-red-400/5",
    signals: ["Badge physically removed from case", "BLE beacon gap > 30 seconds", "Door exit event without checkout", "Session still active post-boundary"],
    outcome: "DENY — decision + evidence recorded; lost-mode stays an approval-gated MDM action",
    outcomeColor: "text-red-400",
  },
  {
    phase: "04",
    title: "Post-Exit Recovery",
    color: "text-purple-400 border-purple-400/20 bg-purple-400/5",
    signals: ["eSIM cellular keepalive active", "Carrier location fix (candidate signal — no carrier integration)", "Last known BLE zone logged", "Wipe recommendation — approval-gated, executed by your MDM"],
    outcome: "RECOVER — escalation recommended + asset trace evidence",
    outcomeColor: "text-purple-400",
  },
];

export default function Hardware() {
  return (
    <div className="dark min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />
      <main className="flex-1">

        {/* Hero */}
        <section className="py-24 border-b border-border/50">
          <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
            <div className="flex flex-col lg:flex-row gap-16 items-start">
              <div className="flex-1">
                <div className="inline-flex items-center gap-2 text-primary text-sm font-mono mb-4">
                  <Cpu className="w-4 h-4" /> SIGNALGRID HARDWARE
                </div>
                <h1 className="text-4xl font-bold tracking-tight mb-6 leading-tight">
                  The Badge-Locking<br />Device Case
                </h1>
                <p className="text-lg text-muted-foreground leading-relaxed mb-6">
                  A hardened device carrier that physically binds badge custody to digital identity. BLE + UWB zone detection, electromagnetic badge lock, eSIM cellular keepalive, and tamper-evident post-exit recovery — in a shift-durable form factor. Custody, charge, and tamper events feed the decision engine through the DockBridge custody connector.
                </p>
                <div className="mb-8 rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-200/80">
                  Pre-production hardware design concept. The specifications below are <span className="font-medium">design targets</span>, not shipped or certified. SignalGrid runs software-only today; this hardware layer is optional and fixture-backed. Nothing here is available for sale.
                </div>
                <div className="flex flex-wrap gap-3 mb-8">
                  {["FIPS 140-2 L2 (target)", "MIL-STD-810H (target)", "IP54 (target)", "EAL5+-class SE (target)", "CAT-M1 eSIM (target)"].map(b => (
                    <span key={b} className="text-xs font-mono px-2.5 py-1 rounded border border-primary/20 bg-primary/5 text-primary">{b}</span>
                  ))}
                </div>
                <div className="flex gap-3">
                  <a href={REPO} target="_blank" rel="noopener noreferrer" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors">Talk to us about a design pilot</a>
                  <a href={`${REPO}/blob/main/docs/SIGNALGRID_SMARTDOCK.md`} target="_blank" rel="noopener noreferrer" className="px-5 py-2.5 border border-border text-foreground rounded-md text-sm font-medium hover:border-primary/50 transition-colors">Read the SmartDock design</a>
                </div>
              </div>

              {/* Device diagram */}
              <div className="lg:w-96 shrink-0">
                <div className="relative bg-card border border-border rounded-2xl p-8 font-mono text-xs">
                  <div className="text-xs text-muted-foreground mb-6 uppercase tracking-wide">Badge-Locking Case · Design Concept</div>
                  <div className="space-y-2.5">
                    {[
                      { icon: Shield, label: "BADGE SLOT", desc: "ISO 7816 + NFC", color: "text-primary" },
                      { icon: Lock, label: "EM LATCH", desc: "Electromagnetic lock", color: "text-amber-400" },
                      { icon: Radio, label: "BLE + UWB", desc: "5.3 + 802.15.4a", color: "text-teal-400" },
                      { icon: Wifi, label: "eSIM MODULE", desc: "CAT-M1 / LTE", color: "text-purple-400" },
                      { icon: Cpu, label: "SECURE ELEMENT", desc: "EAL5+-class (design target)", color: "text-green-400" },
                      { icon: Battery, label: "BATTERY", desc: "4,800 mAh · 12h", color: "text-orange-400" },
                    ].map(({ icon: Icon, label, desc, color }) => (
                      <div key={label} className="flex items-center gap-3 p-2.5 rounded border border-border bg-background/50">
                        <Icon className={`w-4 h-4 shrink-0 ${color}`} />
                        <div className="flex-1">
                          <div className={`font-semibold ${color}`}>{label}</div>
                          <div className="text-muted-foreground text-[11px]">{desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Detection phases */}
        <section className="py-20 border-b border-border/50 bg-zinc-950">
          <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
            <div className="mb-12">
              <h2 className="text-2xl font-bold tracking-tight mb-3">4-Phase Custody Detection</h2>
              <p className="text-muted-foreground">From nominal operation to post-exit recovery — one deterministic model of the whole custody arc.</p>
              <p className="mt-2 text-sm text-muted-foreground/70">Modeled deterministically on public-safe fixtures; UWB, PACS door events, and carrier location are candidate signals, not evaluated today.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {DETECTION_PHASES.map((phase, idx) => (
                <motion.div
                  key={phase.phase}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.1 }}
                  className={`rounded-xl border p-6 ${phase.color}`}
                >
                  <div className="text-2xl font-bold font-mono mb-2 opacity-40">{phase.phase}</div>
                  <h3 className="font-semibold text-foreground mb-4">{phase.title}</h3>
                  <ul className="space-y-2 mb-5">
                    {phase.signals.map(s => (
                      <li key={s} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <span className="mt-0.5 shrink-0 text-muted-foreground/40">·</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                  <div className={`text-xs font-mono font-semibold ${phase.outcomeColor}`}>{phase.outcome}</div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* SmartDock — the optional embedded hardware layer */}
        <section className="py-20 border-b border-border/50">
          <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
            <div className="mb-12 max-w-3xl">
              <div className="inline-flex items-center gap-2 text-teal-400 text-sm font-mono mb-3">
                <Battery className="w-4 h-4" /> SIGNALGRID SMARTDOCK · OPTIONAL LAYER
              </div>
              <h2 className="text-2xl font-bold tracking-tight mb-3">A dedicated smart-charging dock, with SignalGrid embedded.</h2>
              <p className="text-muted-foreground leading-relaxed">
                SmartDock is the optional hardware layer for teams that want more control of the grid and their signals — a sophisticated phone dock and smart-charging station that would run the SignalGrid agent in firmware — the firmware core is CI-compiled for its Cortex-M target and has never run on real hardware. It complements existing shared-device and mobile-access platforms rather than replacing them, and it's a candidate we'd build directly or as a partnership. The product runs software-only today; the dock is additive.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {SMARTDOCK.map(({ title, body, icon: Icon, color }) => (
                <motion.div
                  key={title}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  className="rounded-xl border border-border/50 bg-card/50 p-6"
                >
                  <Icon className={`w-5 h-5 mb-3 ${color}`} />
                  <h3 className="font-semibold text-foreground mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                </motion.div>
              ))}
            </div>
            <div className="mt-6 flex flex-col sm:flex-row items-start sm:items-center gap-3 text-sm text-muted-foreground">
              <span className="font-mono text-xs px-2.5 py-1 rounded border border-teal-400/20 bg-teal-400/5 text-teal-400 shrink-0">INGESTION MODE: embedded_smartdock</span>
              <span>Modeled end-to-end in the deterministic core (connector → sync → normalized signals → decision → audit), fixture-backed and read-only.</span>
            </div>
          </div>
        </section>

        {/* Specs */}
        <section className="py-20">
          <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
            <h2 className="text-2xl font-bold tracking-tight mb-3">Technical Specifications</h2>
            <p className="text-sm text-muted-foreground/70 mb-10 max-w-2xl">
              Every figure below is a design target — nothing here has been built or measured, and
              no SKU exists. This is the specification we are designing toward, published so it can
              be challenged.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
              {SPECS.map(cat => (
                <div key={cat.category} className="space-y-3">
                  <div className="text-xs font-mono text-muted-foreground uppercase tracking-wide border-b border-border pb-2">
                    {cat.category}
                  </div>
                  {cat.items.map(item => (
                    <div key={item.label} className="flex flex-col">
                      <span className="text-xs text-muted-foreground">{item.label}</span>
                      <span className="text-sm font-mono font-medium text-foreground">{item.value}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 border-t border-border/50 bg-zinc-950">
          <div className="container mx-auto px-4 md:px-8 max-w-screen-xl flex flex-col md:flex-row items-center justify-between gap-8">
            <div>
              <h3 className="text-xl font-bold mb-2">Explore a design-partner pilot</h3>
              <p className="text-muted-foreground text-sm">This hardware is a pre-production design concept, not a shipping product. Review the deterministic core and the SmartDock design, or reach out about a design-partner collaboration.</p>
            </div>
            <div className="flex gap-3 shrink-0">
              <a href={REPO} target="_blank" rel="noopener noreferrer" className="px-6 py-3 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors">Explore the repo</a>
              <a href={`${REPO}/blob/main/docs/SIGNALGRID_SMARTDOCK.md`} target="_blank" rel="noopener noreferrer" className="px-6 py-3 border border-border rounded-md font-medium hover:border-primary/50 transition-colors">SmartDock design</a>
            </div>
          </div>
        </section>

      </main>
      <Footer />
    </div>
  );
}
