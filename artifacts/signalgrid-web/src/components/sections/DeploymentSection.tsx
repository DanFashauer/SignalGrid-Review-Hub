import { motion } from "framer-motion";
import { Cloud, Server, ShieldCheck } from "lucide-react";

const DEPLOYMENT_OPTIONS = [
  {
    title: "SignalGrid Cloud",
    icon: Cloud,
    type: "SaaS / Multi-Tenant",
    desc: "A managed, auto-scaling design with regional processing targets — EU, US, APAC. Availability and operational targets are design goals, not a live service offering.",
    features: [
      "Zero maintenance, auto-scaling design",
      "PHI-access controls by design",
      "High-availability design target",
      "Regional data residency",
    ],
    compliance: ["SOC 2", "HIPAA", "ISO 27001", "PCI DSS"],
    highlight: true,
    cta: "Request a walkthrough",
  },
  {
    title: "Self-Hosted",
    icon: Server,
    type: "VPC / On-Premise",
    desc: "Run in your own VPC or on-premise using Docker Compose today; Helm packaging is a documented next step. Full data sovereignty — telemetry never leaves your environment.",
    features: [
      "Full data sovereignty",
      "Docker Compose today (Helm: documented next step)",
      "Custom scaling and HA config",
      "FIPS 140-2-oriented crypto design",
      "Bring your own PKI",
    ],
    compliance: ["NIST 800-53", "CMMC 2.0", "FedRAMP-path"],
    highlight: false,
    cta: "View Docs",
  },
  {
    title: "Air-Gapped",
    icon: ShieldCheck,
    type: "Classified / Regulated",
    desc: "Fully isolated deployment for critical infrastructure, DoD, and IC environments. Zero external data transmission. Offline license validation.",
    features: [
      "Zero external network connectivity",
      "Offline license and update model",
      "DISA STIG-oriented base image",
      "SCAP/XCCDF benchmark mapping",
      "IL4 / IL5-oriented architecture",
    ],
    compliance: ["DISA STIG", "FedRAMP High", "DoD IL2–IL5", "CMMC L3", "ITAR"],
    highlight: false,
    cta: "Request a walkthrough",
  },
];

const RESILIENCE_PROOFS = [
  { label: "5xx Under Overload", value: "0", desc: "Deliberate concurrency and overload — zero server errors" },
  { label: "Transport Errors", value: "0", desc: "Every request answered, none dropped" },
  { label: "Determinism", value: "Identical", desc: "Every concurrent outcome matches the single-request answer" },
  { label: "Throttling", value: "429", desc: "Standard back-off headers on every throttled response" },
  { label: "Rate Limit", value: "240/min", desc: "Per-key default — operator-tunable" },
  { label: "Gated In CI", value: "test:load", desc: "Correctness gated on every push; test:stress runs on demand" },
];

export default function DeploymentSection() {
  return (
    <section className="py-24 bg-zinc-950" id="deployment">
      <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">

        <div className="text-center mb-16 max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold tracking-tight mb-4">Deploy Where Your Controls Live</h2>
          <p className="text-muted-foreground text-lg">
            Security infrastructure must match your regulatory environment, sovereignty requirements, and classification level — not force you into a shared cloud model.
          </p>
        </div>

        {/* Deployment options */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          {DEPLOYMENT_OPTIONS.map((opt, idx) => (
            <motion.div
              key={opt.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.1 }}
              className={`relative p-8 rounded-xl border flex flex-col ${
                opt.highlight
                  ? "border-primary shadow-[0_0_30px_-10px_rgba(79,140,135,0.35)] bg-primary/5"
                  : "border-border/50 bg-card"
              }`}
            >
              <opt.icon className={`w-7 h-7 mb-5 ${opt.highlight ? "text-primary" : "text-muted-foreground"}`} />
              <div className="text-xs font-mono text-muted-foreground mb-1.5">{opt.type}</div>
              <h3 className="text-lg font-semibold mb-3">{opt.title}</h3>
              <p className="text-sm text-muted-foreground mb-5 leading-relaxed">{opt.desc}</p>

              <ul className="space-y-2 mb-6">
                {opt.features.map((feat) => (
                  <li key={feat} className="flex items-center text-sm">
                    <svg
                      className={`w-3.5 h-3.5 mr-2.5 shrink-0 ${opt.highlight ? "text-primary" : "text-muted-foreground"}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {feat}
                  </li>
                ))}
              </ul>

              {/* Compliance badges */}
              <div className="mt-auto pt-4 border-t border-border/40">
                <div className="text-xs font-mono text-muted-foreground mb-2">DESIGNED TOWARD (not certifications held)</div>
                <div className="flex flex-wrap gap-1.5">
                  {opt.compliance.map((c) => (
                    <span
                      key={c}
                      className="text-xs font-mono px-1.5 py-0.5 rounded border border-primary/20 bg-primary/5 text-primary"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>

              <a
                href={opt.cta === "View Docs"
                  ? "https://github.com/DanFashauer/SignalGrid-Review-Hub/tree/main/docs"
                  : "https://github.com/DanFashauer/SignalGrid-Review-Hub"}
                target="_blank"
                rel="noopener noreferrer"
                className={`mt-6 block text-center w-full py-2.5 rounded-md text-sm font-medium transition-colors ${
                  opt.highlight
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {opt.cta}
              </a>
            </motion.div>
          ))}
        </div>

        {/* Disaster Recovery & resilience */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="rounded-xl border border-border bg-card p-8"
        >
          <div className="flex flex-col md:flex-row md:items-start gap-8">
            <div className="md:w-72 shrink-0">
              <div className="text-xs font-mono text-muted-foreground mb-2">MEASURED RESILIENCE</div>
              <h3 className="text-lg font-semibold mb-3">Proven Under Load, Not Promised</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Under deliberate concurrency and overload, the decision API returns zero 5xx and zero transport errors, every outcome identical to the single-request answer, and throttled requests get a clean 429 with standard back-off headers — gated in CI on every run. No availability target is offered and no failover machinery ships today; what we claim is what the gates measure.
              </p>
            </div>
            <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {RESILIENCE_PROOFS.map((cap) => (
                <div key={cap.label} className="rounded-lg border border-border/60 bg-background/50 p-4">
                  <div className="text-xs font-mono text-muted-foreground mb-1">{cap.label}</div>
                  <div className="text-base font-bold font-mono text-primary mb-1">{cap.value}</div>
                  <div className="text-xs text-muted-foreground">{cap.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-border/40">
            <div className="text-xs font-mono text-muted-foreground mb-3">CANDIDATE DR SIGNAL SOURCES — none is a live integration</div>
            <div className="flex flex-wrap gap-2">
              {["Veeam", "Zerto", "Rubrik", "Cohesity", "Commvault", "AWS Elastic DR", "Azure Site Recovery", "Veritas NetBackup", "Acronis Cyber Protect"].map((tool) => (
                <span
                  key={tool}
                  className="text-xs font-mono px-2.5 py-1 rounded border border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                >
                  {tool}
                </span>
              ))}
            </div>
          </div>
        </motion.div>

      </div>
    </section>
  );
}
