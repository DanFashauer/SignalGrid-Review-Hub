import { motion } from "framer-motion";
import { ShieldAlert, ArrowRight, CheckCircle2 } from "lucide-react";

const SILOS = [
  "Badge / access control system",
  "MDM / UEM platform",
  "Physical access control (PACS)",
  "Shared device workflow layer",
  "Asset tracking / CMDB",
  "Elevator & specialty area access",
  "Security monitoring / SIEM",
];

export default function ProblemSection() {
  return (
    <section className="py-24 bg-zinc-950 border-b border-border/50">
      <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div className="space-y-8">
            <div>
              <div className="inline-flex items-center gap-2 text-destructive text-sm font-mono mb-4">
                <ShieldAlert className="w-4 h-4" />
                THE FRAGMENTATION PROBLEM
              </div>
              <h2 className="text-3xl font-bold tracking-tight mb-4">Seven Silos. Zero Accountability.</h2>
              <p className="text-muted-foreground text-lg leading-relaxed">
                Every system that should protect a shared device lives in a different silo. The management console knows what it last recorded — not whether that answer is still true. The identity stack knows who logged in this morning — not who is holding the device now. Nothing asks the one question that matters at the moment of action: should this proceed?
              </p>
            </div>

            <div className="flex gap-4 p-4 rounded-lg border border-destructive/20 bg-destructive/5">
              <ShieldAlert className="w-6 h-6 text-destructive shrink-0 mt-1" />
              <div>
                <h4 className="font-semibold text-foreground">The Real Scenario</h4>
                <p className="text-sm text-muted-foreground mt-1">
                  A medication cart iPad is compliant at 08:00. At 14:03 the management agent has stopped reporting, the encryption check has gone unverified, and nothing has re-confirmed the device since morning — but the session is still active, the workflow is still accessible, and every console still shows green because green is just the last thing anyone recorded.
                </p>
              </div>
            </div>

            <div className="flex gap-4 p-4 rounded-lg border border-primary/20 bg-primary/5">
              <CheckCircle2 className="w-6 h-6 text-primary shrink-0 mt-1" />
              <div>
                <h4 className="font-semibold text-foreground">SignalGrid: One Control Plane</h4>
                <p className="text-sm text-muted-foreground mt-1">
                  One question, answered at the moment the workflow fires: is this device compliant, is that answer current, and may it act right now? Missing or stale evidence tightens the verdict — it never passes as green.
                </p>
              </div>
            </div>
          </div>

          <div className="relative space-y-3">
            <div className="text-xs font-mono text-muted-foreground mb-4">BEFORE SIGNALGRID — 7 DISCONNECTED SYSTEMS</div>
            {SILOS.map((silo, idx) => (
              <motion.div
                key={silo}
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: idx * 0.06 }}
                className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-card/50 opacity-70"
              >
                <div className="w-2 h-2 rounded-full bg-destructive/60 shrink-0"></div>
                <span className="text-sm text-muted-foreground">{silo}</span>
                <span className="ml-auto text-xs font-mono text-destructive/60">ISOLATED</span>
              </motion.div>
            ))}

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.5 }}
              className="mt-6 flex items-center gap-3 p-4 rounded-lg border border-primary/30 bg-primary/5"
            >
              <ArrowRight className="w-5 h-5 text-primary shrink-0" />
              <div>
                <div className="text-sm font-semibold text-foreground">SignalGrid Runtime Layer</div>
                <div className="text-xs text-muted-foreground mt-0.5">Three Limited GA signal sources fused into one calibrated decision — the other four are deferred</div>
              </div>
              <span className="ml-auto text-xs font-mono text-primary font-medium">UNIFIED</span>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
