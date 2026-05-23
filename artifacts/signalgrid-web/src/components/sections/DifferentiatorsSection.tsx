import { motion } from "framer-motion";
import { Zap, Target, Layers } from "lucide-react";

export default function DifferentiatorsSection() {
  return (
    <section className="py-24 bg-background border-b border-border/50">
      <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold tracking-tight mb-4">Why Existing Tools Fail Here</h2>
          <p className="text-muted-foreground text-lg">
            Conditional Access and legacy MDMs were built for knowledge workers on dedicated laptops. They fundamentally misunderstand the physics of shared devices.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="p-8 rounded-xl border border-border bg-card relative overflow-hidden group"
          >
            <Zap className="w-8 h-8 text-primary mb-6" />
            <h3 className="text-xl font-semibold mb-3">Time of Evaluation</h3>
            <p className="text-muted-foreground mb-6">
              Conditional Access evaluates at login. SignalGrid evaluates at workflow execution time. When state changes mid-session, we catch it.
            </p>
            <div className="mt-auto pt-6 border-t border-border/50">
              <div className="text-sm font-mono text-muted-foreground">Traditional: 1x per 12h</div>
              <div className="text-sm font-mono text-primary font-medium mt-1">SignalGrid: Continuous</div>
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="p-8 rounded-xl border border-border bg-card relative overflow-hidden group"
          >
            <Target className="w-8 h-8 text-primary mb-6" />
            <h3 className="text-xl font-semibold mb-3">Signal Fidelity</h3>
            <p className="text-muted-foreground mb-6">
              MDM compliance is a snapshot that can be hours old. We run real-time queries against live endpoints in milliseconds.
            </p>
            <div className="mt-auto pt-6 border-t border-border/50">
              <div className="text-sm font-mono text-muted-foreground">Traditional: "Compliant" boolean</div>
              <div className="text-sm font-mono text-primary font-medium mt-1">SignalGrid: Live agent status</div>
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="p-8 rounded-xl border border-border bg-card relative overflow-hidden group"
          >
            <Layers className="w-8 h-8 text-primary mb-6" />
            <h3 className="text-xl font-semibold mb-3">Additive Enforcement</h3>
            <p className="text-muted-foreground mb-6">
              SignalGrid doesn't replace Intune, Okta, or ServiceNow. It sits on top, consuming their signals to build a complete runtime context.
            </p>
            <div className="mt-auto pt-6 border-t border-border/50">
              <div className="text-sm font-mono text-muted-foreground">Traditional: Siloed engines</div>
              <div className="text-sm font-mono text-primary font-medium mt-1">SignalGrid: Context fusion</div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
