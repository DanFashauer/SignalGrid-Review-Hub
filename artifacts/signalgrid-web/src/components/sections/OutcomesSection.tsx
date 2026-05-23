import { motion } from "framer-motion";
import decisionFlowImg from "@/assets/decision-flow.png";

export default function OutcomesSection() {
  const outcomes = [
    {
      action: "Allow",
      condition: "All signals nominal",
      result: "Workflow access granted instantly.",
      color: "text-emerald-500",
      borderColor: "border-emerald-500/30",
      bg: "bg-emerald-500/10"
    },
    {
      action: "Step-Up",
      condition: "One anomalous signal",
      result: "Secondary verification required before proceeding.",
      color: "text-blue-500",
      borderColor: "border-blue-500/30",
      bg: "bg-blue-500/10"
    },
    {
      action: "Restrict",
      condition: "Two+ anomalous signals",
      result: "Limited read-only workflow access granted.",
      color: "text-amber-500",
      borderColor: "border-amber-500/30",
      bg: "bg-amber-500/10"
    },
    {
      action: "Deny",
      condition: "Critical signal failure",
      result: "Access blocked, automated remediation triggered.",
      color: "text-destructive",
      borderColor: "border-destructive/30",
      bg: "bg-destructive/10"
    }
  ];

  return (
    <section className="py-24 bg-zinc-950 border-b border-border/50 relative overflow-hidden">
      <div className="absolute top-1/2 left-0 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[120px] pointer-events-none"></div>
      
      <div className="container mx-auto px-4 md:px-8 max-w-screen-xl relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="rounded-xl border border-border/50 bg-card overflow-hidden shadow-2xl p-1"
          >
            <div className="rounded-lg overflow-hidden relative group">
              <img src={decisionFlowImg} alt="Decision Flow Architecture" className="w-full h-auto object-cover opacity-80 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="absolute inset-0 ring-1 ring-inset ring-white/10 rounded-lg pointer-events-none"></div>
            </div>
          </motion.div>

          <div className="space-y-8">
            <div>
              <h2 className="text-3xl font-bold tracking-tight mb-4">Calibrated Decision Outcomes</h2>
              <p className="text-muted-foreground text-lg leading-relaxed">
                Binary allow/deny rules are insufficient for frontline operations. SignalGrid produces one of four calibrated responses based on aggregate signal risk scoring.
              </p>
            </div>

            <div className="space-y-4">
              {outcomes.map((outcome, idx) => (
                <motion.div 
                  key={outcome.action}
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: idx * 0.1 }}
                  className={`p-5 rounded-lg border border-border bg-card/50 flex flex-col sm:flex-row sm:items-center gap-4 hover:border-border/80 transition-colors`}
                >
                  <div className={`w-24 shrink-0 flex items-center justify-center py-1.5 px-3 rounded-md border ${outcome.borderColor} ${outcome.bg} font-mono text-sm font-semibold tracking-widest ${outcome.color}`}>
                    {outcome.action.toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-foreground mb-1">{outcome.condition}</div>
                    <div className="text-sm text-muted-foreground">{outcome.result}</div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
