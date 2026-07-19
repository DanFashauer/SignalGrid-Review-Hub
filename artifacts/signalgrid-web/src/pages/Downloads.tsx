import { motion } from "framer-motion";
import { Download, Monitor, Smartphone, CheckCircle2 } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

// Pre-announcement app-suite preview. These are the review-artifact surfaces
// (responsive web + PWA today; native shells are a documented next step). No
// download is live yet — the badges describe availability status, not a file.
const PLATFORMS = [
  {
    icon: Monitor,
    name: "Web Admin Console",
    subtitle: "Any modern browser",
    desc: "The administrative surface: decision stream, evidence inspection (including the security-baseline/CIS signal), policy lab, tamper-evident audit ledger, and approval-gated remediation. Runs as a responsive web app today.",
    version: "Web · pre-announcement",
    options: [
      { label: "Open the web console", ext: "", size: "", badge: "WEB" },
      { label: "Self-host (Docker / Helm)", ext: "", size: "", badge: "DESIGN" },
    ],
    features: ["Decision feed + evidence", "Security-baseline (CIS) row", "Policy lab (v1 vs v2)", "Audit ledger", "Approval-gated remediation"],
  },
  {
    icon: Monitor,
    name: "Desktop (macOS / Windows)",
    subtitle: "Desktop-chromed operator console",
    desc: "The operator/admin surface framed for macOS and Windows, adding an ITSM hand-off view. Delivered today as a desktop-chromed web app; native shells (Tauri/Electron) are a documented next step, not shipped.",
    version: "Desktop · pre-announcement",
    options: [
      { label: "macOS shell", ext: "", size: "", badge: "PLANNED" },
      { label: "Windows shell", ext: "", size: "", badge: "PLANNED" },
    ],
    features: ["Operator dashboard", "Shift hand-off view", "Decision + evidence trace", "Audit export"],
  },
  {
    icon: Smartphone,
    name: "Mobile PWA (iOS / Android)",
    subtitle: "Installable progressive web app",
    desc: "An installable operator/support PWA: an 'Access support' tab where a support lead triages a worker's session and sees the guidance to relay, plus operator monitoring tabs. The worker's own resolution stays embedded in their host app — no SignalGrid worker screen. Native React Native/Expo shells are a documented next step.",
    version: "PWA · pre-announcement",
    options: [
      { label: "Install via browser (Add to Home Screen)", ext: "", size: "", badge: "PWA" },
      { label: "Native iOS / Android shell", ext: "", size: "", badge: "PLANNED" },
    ],
    features: ["Access-support triage", "Guidance to relay to workers", "Operator monitoring tabs", "Offline-capable (PWA)"],
  },
];

const SYSTEM_REQUIREMENTS = [
  { platform: "Web", req: "Any modern evergreen browser (Chromium, Safari, Firefox)" },
  { platform: "macOS", req: "macOS 13 Ventura or later (desktop-chromed web today)" },
  { platform: "Windows", req: "Windows 10 22H2 or later (desktop-chromed web today)" },
  { platform: "Android", req: "Android 10+ · installable PWA via Chrome" },
  { platform: "iOS", req: "iOS 16+ · Safari 16.4+ for PWA installation" },
  { platform: "Delivery", req: "Responsive web + PWA today; native shells are a documented next step" },
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
              <p className="text-muted-foreground text-lg">Web admin, desktop, and a mobile PWA that serves both the operator and the end-user worker — all backed by the same deterministic decision core.</p>
              <div className="mt-6 inline-block rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-muted-foreground">
                <span className="text-amber-400 font-medium">Pre-announcement:</span> these surfaces are review artifacts. Delivery today is responsive web + PWA; native desktop/mobile shells are a documented next step. Downloads are not yet live.
              </div>
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
                        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wide">Downloads</div>
                        <span className="text-xs font-mono text-muted-foreground">{platform.version}</span>
                      </div>
                      <div className="space-y-2">
                        {platform.options.map(opt => (
                          <a key={opt.label} href="https://github.com/DanFashauer/SignalGrid-Review-Hub" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-3 rounded-lg border border-border bg-background/50 hover:border-primary/40 hover:bg-primary/5 transition-colors group cursor-pointer">
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
                          </a>
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
