import { motion } from "framer-motion";
import { Cloud, Server, ShieldCheck } from "lucide-react";

export default function DeploymentSection() {
  const options = [
    {
      title: "SignalGrid Cloud",
      icon: Cloud,
      type: "SaaS",
      desc: "Managed, auto-scaling infrastructure with enterprise SLAs. Ideal for cloud-native organizations.",
      features: ["Zero maintenance", "Enterprise contracts", "SOC 2 Type II compliant"],
      highlight: true
    },
    {
      title: "Self-Hosted",
      icon: Server,
      type: "Bring Your Own Infra",
      desc: "Run anywhere using Docker Compose or Kubernetes Helm charts. Keep telemetry in your VPC.",
      features: ["Free for self-hosted", "Full data sovereignty", "Custom scaling"],
      highlight: false
    },
    {
      title: "Air-Gapped",
      icon: ShieldCheck,
      type: "Regulated",
      desc: "Completely isolated environments for critical infrastructure and government deployments.",
      features: ["Zero external transmission", "Offline license validation", "FIPS 140-2 ready"],
      highlight: false
    }
  ];

  return (
    <section className="py-24 bg-zinc-950" id="deployment">
      <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold tracking-tight mb-4">Deploy Your Way</h2>
          <p className="text-muted-foreground text-lg">
            Security infrastructure should match your operational requirements, not force you into a specific deployment model.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {options.map((opt, idx) => (
            <motion.div 
              key={opt.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.1 }}
              className={`relative p-8 rounded-xl border ${opt.highlight ? 'border-primary shadow-[0_0_30px_-10px_rgba(59,130,246,0.3)] bg-primary/5' : 'border-border/50 bg-card'}`}
            >
              {opt.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-primary text-primary-foreground text-xs font-bold tracking-wider rounded-full uppercase">
                  Most Popular
                </div>
              )}
              <opt.icon className={`w-8 h-8 mb-6 ${opt.highlight ? 'text-primary' : 'text-muted-foreground'}`} />
              <div className="text-sm font-mono text-muted-foreground mb-2">{opt.type}</div>
              <h3 className="text-xl font-semibold mb-3">{opt.title}</h3>
              <p className="text-sm text-muted-foreground mb-6 h-16">{opt.desc}</p>
              
              <ul className="space-y-3 mt-auto">
                {opt.features.map(feat => (
                  <li key={feat} className="flex items-center text-sm font-medium">
                    <svg className={`w-4 h-4 mr-3 ${opt.highlight ? 'text-primary' : 'text-muted-foreground'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {feat}
                  </li>
                ))}
              </ul>
              
              <div className="mt-8">
                <button className={`w-full py-2.5 rounded-md text-sm font-medium transition-colors ${opt.highlight ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}>
                  {opt.title === "Self-Hosted" ? "View Docs" : "Contact Sales"}
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
