import { motion } from "framer-motion";
import { Download, Monitor, Smartphone, Terminal, CheckCircle2 } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

const PLATFORMS = [
  {
    icon: Monitor,
    name: "SignalGrid Desktop",
    subtitle: "Windows · macOS · Linux",
    desc: "Full-featured desktop client with native window chrome, three-panel layout, system tray integration, and real-time desktop notifications. Built on the same decision engine as the operator dashboard.",
    version: "v2.1.0",
    options: [
      { label: "Windows x64 (MSI)", ext: ".msi", size: "84 MB", badge: "RECOMMENDED" },
      { label: "macOS Universal (DMG)", ext: ".dmg", size: "91 MB", badge: "" },
      { label: "macOS Apple Silicon", ext: ".dmg", size: "78 MB", badge: "" },
      { label: "Linux x64 (AppImage)", ext: ".AppImage", size: "96 MB", badge: "" },
      { label: "Linux x64 (DEB)", ext: ".deb", size: "64 MB", badge: "" },
      { label: "Linux x64 (RPM)", ext: ".rpm", size: "67 MB", badge: "" },
    ],
    features: ["Real-time decision feed", "Shift Handoff dashboard", "CSV audit export", "System notifications", "Offline policy cache"],
  },
  {
    icon: Smartphone,
    name: "SignalGrid Android",
    subtitle: "Android 10+ · Zebra · Honeywell · Datalogic",
    desc: "Native Android app with Zebra DataWedge intent integration, badge scan events, MDM enrollment support, and offline-capable signal caching for warehouse, clinical, and field environments.",
    version: "v2.1.0",
    options: [
      { label: "Android (APK — Universal)", ext: ".apk", size: "38 MB", badge: "" },
      { label: "Zebra Build (DataWedge Enhanced)", ext: ".apk", size: "41 MB", badge: "ZEBRA OPTIMIZED" },
      { label: "Google Play Store", ext: "", size: "", badge: "ENTERPRISE" },
      { label: "Managed Google Play (EMM)", ext: "", size: "", badge: "MDM DEPLOY" },
    ],
    features: ["Zebra DataWedge integration", "Badge scan custody events", "Android Enterprise support", "Offline signal cache", "MDM policy enforcement"],
  },
  {
    icon: Smartphone,
    name: "SignalGrid iOS",
    subtitle: "iOS 16+ · iPad · iPhone",
    desc: "Progressive Web App installable from Safari. Full dashboard access, real-time decision monitoring, and shift handoff management. Add to Home Screen for app-like experience.",
    version: "v2.1.0",
    options: [
      { label: "Install via Safari (PWA)", ext: "", size: "", badge: "RECOMMENDED" },
      { label: "TestFlight (Beta)", ext: "", size: "", badge: "BETA" },
    ],
    features: ["Full operator dashboard", "Real-time alerts", "Offline capable (PWA)", "Biometric auth", "iPad split-view"],
  },
  {
    icon: Terminal,
    name: "SignalGrid CLI",
    subtitle: "Windows · macOS · Linux",
    desc: "Command-line interface for DevSecOps workflows. Query decisions, manage policies, ingest signals, and export audit logs from scripts and CI/CD pipelines.",
    version: "v1.4.2",
    options: [
      { label: "macOS (Homebrew)", ext: "", size: "", badge: "" },
      { label: "Windows (winget)", ext: "", size: "", badge: "" },
      { label: "Linux (APT / YUM)", ext: "", size: "", badge: "" },
      { label: "Binary release (all platforms)", ext: ".tar.gz", size: "12 MB", badge: "" },
    ],
    features: ["Decision query + filter", "Policy CRUD", "Audit log export", "Signal ingest", "CI/CD integration"],
  },
];

const SYSTEM_REQUIREMENTS = [
  { platform: "Windows", req: "Windows 10 22H2 or later · 4 GB RAM · 500 MB disk" },
  { platform: "macOS", req: "macOS 13 Ventura or later · Apple Silicon or Intel" },
  { platform: "Linux", req: "Ubuntu 22.04 / RHEL 8+ · glibc 2.31+" },
  { platform: "Android", req: "Android 10+ · 2 GB RAM · ARM64 or x86_64" },
  { platform: "iOS", req: "iOS 16+ · Safari 16.4+ for PWA installation" },
  { platform: "Zebra", req: "Zebra Android 10+ · DataWedge 7.0+ · StageNow 3.4+" },
];

export default function Downloads() {
  return (
    <div className="dark min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />
      <main className="flex-1">

        <section className="py-24 border-b border-border/50">
          <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
            <div className="text-center mb-16 max-w-2xl mx-auto">
              <div className="inline-flex items-center gap-2 text-primary text-sm font-mono mb-4">
                <Download className="w-4 h-4" /> DOWNLOADS
              </div>
              <h1 className="text-4xl font-bold tracking-tight mb-4">Every Platform. One Decision Engine.</h1>
              <p className="text-muted-foreground text-lg">Desktop, mobile, Zebra-native, and CLI — all backed by the same real-time Zero Trust signal evaluation engine.</p>
            </div>

            <div className="space-y-8">
              {PLATFORMS.map((platform, idx) => (
                <motion.div
                  key={platform.name}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.08 }}
                  className="bg-card border border-border rounded-xl p-8"
                >
                  <div className="flex flex-col lg:flex-row gap-8">
                    <div className="lg:w-80 shrink-0">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
                          <platform.icon className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <div className="font-semibold">{platform.name}</div>
                          <div className="text-xs font-mono text-muted-foreground">{platform.subtitle}</div>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed mb-4">{platform.desc}</p>
                      <div className="text-xs font-mono text-muted-foreground mb-3">INCLUDED FEATURES</div>
                      <ul className="space-y-1.5">
                        {platform.features.map(f => (
                          <li key={f} className="flex items-center gap-2 text-xs text-foreground/70">
                            <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-4">
                        <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Downloads</div>
                        <span className="text-xs font-mono text-muted-foreground">{platform.version}</span>
                      </div>
                      <div className="space-y-2">
                        {platform.options.map(opt => (
                          <div key={opt.label} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background/50 hover:border-primary/40 hover:bg-primary/5 transition-colors group cursor-pointer">
                            <div className="flex items-center gap-3">
                              <Download className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                              <div>
                                <div className="text-sm font-medium">{opt.label}</div>
                                {opt.size && <div className="text-xs font-mono text-muted-foreground">{opt.size}</div>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {opt.badge && (
                                <span className="text-xs font-mono px-2 py-0.5 rounded border border-primary/20 bg-primary/5 text-primary">{opt.badge}</span>
                              )}
                              {opt.ext && <span className="text-xs font-mono text-muted-foreground">{opt.ext}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* System requirements */}
        <section className="py-16 bg-zinc-950">
          <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
            <h2 className="text-lg font-semibold mb-6">System Requirements</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {SYSTEM_REQUIREMENTS.map(r => (
                <div key={r.platform} className="bg-card border border-border rounded-lg p-4">
                  <div className="text-xs font-mono text-primary mb-1.5">{r.platform.toUpperCase()}</div>
                  <div className="text-xs text-muted-foreground">{r.req}</div>
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
