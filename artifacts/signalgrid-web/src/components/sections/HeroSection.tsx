import { motion } from "framer-motion";

// Vendor-neutral candidate signal categories (public-safe fixture values, not
// named live vendor integrations).
const LIVE_SIGNALS = [
  { label: "BADGE", value: "INSERTED", color: "text-orange-400" },
  { label: "IDENTITY", value: "ENABLED", color: "text-teal-400" },
  { label: "DEVICE POSTURE", value: "COMPLIANT", color: "text-green-400" },
  { label: "LOCATION", value: "ZONE 3B / ICU", color: "text-teal-400" },
  { label: "SHIFT", value: "07:00–19:00 MATCHED", color: "text-purple-400" },
  { label: "SECURITY BASELINE", value: "CIS ALIGNED", color: "text-green-400" },
  { label: "CUSTODY (DOCKBRIDGE)", value: "CHECKED OUT", color: "text-teal-400" },
];

export default function HeroSection() {
  return (
    <section className="relative bg-background pt-28 pb-32 md:pt-36 md:pb-40 border-b border-border/50">
      <div className="container relative z-10 mx-auto px-4 md:px-8 max-w-screen-xl">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-8 items-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="flex flex-col items-start text-left"
          >
            <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-medium text-primary mb-6">
              <span className="flex h-2 w-2 rounded-full bg-primary mr-2 animate-pulse"></span>
              Contextual Workforce Trust Orchestration
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground mb-6 leading-tight text-balance">
              Every access signal,<br className="hidden md:block" />
              <span className="text-primary">turned into one clear call.</span>
            </h1>

            <p className="text-lg text-muted-foreground mb-8 max-w-[600px] leading-relaxed text-pretty">
              The moment a workflow fires, SignalGrid reads the signals that matter — identity, device
              posture, physical custody, and security baseline — and turns them into a simple decision:
              allow, step-up, restrict, or deny. You choose the action.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
              <a href="https://github.com/DanFashauer/SignalGrid-Review-Hub/blob/main/docs/PARTNER_ONBOARDING.md" target="_blank" rel="noopener noreferrer" className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90">
                Start with the fixture demo — zero install, zero accounts
              </a>
              <a href="https://github.com/DanFashauer/SignalGrid-Review-Hub/tree/main/docs" target="_blank" rel="noopener noreferrer" className="inline-flex h-12 items-center justify-center rounded-md border border-input bg-background px-8 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground">
                Read Architecture Docs
              </a>
            </div>

            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {["Fixture-backed proof", "On-premise-ready design", "Air-gap-capable design", "Systems of record stay external"].map((t) => (
                <div key={t} className="flex items-center">
                  <svg className="mr-2 h-4 w-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                  {t}
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.2, ease: "easeOut" }}
            className="relative lg:ml-auto w-full max-w-[580px]"
          >
            <div className="rounded-xl border border-border/50 bg-card shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-muted/30">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
                  <span className="text-xs font-mono text-muted-foreground">SIGNALGRID DECISION ENGINE — FIXTURE PROOF</span>
                </div>
                <span className="text-xs font-mono text-muted-foreground">14:03:47.821</span>
              </div>

              <div className="p-5 space-y-1">
                <div className="text-xs font-mono text-muted-foreground mb-3">EVALUATING REQUEST — device:SG-0847 workflow:MAR_DISPENSE</div>
                {LIVE_SIGNALS.map((sig, i) => (
                  <motion.div
                    key={sig.label}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4 + i * 0.08 }}
                    className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0"
                  >
                    <span className="text-xs font-mono text-muted-foreground w-32 shrink-0">{sig.label}</span>
                    <span className={`text-xs font-mono font-medium ${sig.color}`}>{sig.value}</span>
                  </motion.div>
                ))}
              </div>

              <div className="px-5 pb-5">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 1.1 }}
                  className="flex items-center justify-between rounded-md bg-emerald-500/10 border border-emerald-500/30 px-4 py-3"
                >
                  <span className="text-xs font-mono font-semibold text-emerald-400">DECISION: ALLOW</span>
                  <span className="text-xs font-mono text-muted-foreground">DETERMINISTIC</span>
                </motion.div>
              </div>

              <div className="grid grid-cols-3 gap-px bg-border/30 border-t border-border/30">
                {[
                  { label: "SIGNALS FUSED", value: "7" },
                  { label: "CORE SIGNAL CATEGORIES", value: "17" },
                  { label: "EVALUATION", value: "FIXTURE" },
                ].map((s) => (
                  <div key={s.label} className="bg-card px-4 py-3 text-center">
                    <div className="text-lg font-bold font-mono text-foreground">{s.value}</div>
                    <div className="text-xs font-mono text-muted-foreground mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
