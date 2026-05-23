import { motion } from "framer-motion";
import { ShieldCheck, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

const COMPLIANCE_STATUS = [
  { framework: "DISA STIG", status: "available", detail: "Hardened base image · SCAP/XCCDF benchmark · CAT I/II/III decision mapping", badge: "AVAILABLE NOW" },
  { framework: "DoD IL2 – IL5", status: "available", detail: "Air-gapped architecture · No external data transmission · Offline license validation", badge: "AVAILABLE NOW" },
  { framework: "CMMC 2.0 Level 3", status: "available", detail: "110 NIST SP 800-171 controls mapped · Policy engine covers all 14 practice domains", badge: "AVAILABLE NOW" },
  { framework: "FedRAMP Moderate", status: "in-progress", detail: "ATO roadmap in progress · 3PAO selected · Expected authorization 2025", badge: "IN PROCESS" },
  { framework: "FedRAMP High", status: "planned", detail: "Roadmap target following Moderate authorization · Available via air-gap deployment", badge: "PLANNED" },
  { framework: "NIST SP 800-53 Rev 5", status: "available", detail: "Full control mapping document available on request · 325 controls addressed", badge: "AVAILABLE NOW" },
  { framework: "NIST SP 800-171", status: "available", detail: "110-control baseline fully addressed · CUI handling procedures documented", badge: "AVAILABLE NOW" },
  { framework: "ITAR / EAR", status: "available", detail: "Air-gap deployment keeps data fully domestic · No third-country transfer", badge: "AVAILABLE NOW" },
];

const STATUS_META: Record<string, { color: string; icon: React.ComponentType<{className?: string}> }> = {
  available: { color: "text-green-400 border-green-400/20 bg-green-400/5", icon: CheckCircle2 },
  "in-progress": { color: "text-yellow-400 border-yellow-400/20 bg-yellow-400/5", icon: Clock },
  planned: { color: "text-muted-foreground border-border bg-muted/10", icon: AlertCircle },
};

const VEHICLES = [
  { name: "GSA Schedule 70", desc: "IT Products and Services · In progress", status: "in-progress" },
  { name: "SEWP V", desc: "NASA SEWP · On-ramping", status: "in-progress" },
  { name: "CIO-SP3", desc: "NIH GWAC · Evaluation underway", status: "planned" },
  { name: "Direct Contract", desc: "Available now via sole-source or competitive", status: "available" },
];

const DEPLOYMENT_FEATURES = [
  "Zero external network connectivity — classified enclave deployable",
  "Offline license validation — no phone-home required",
  "DISA STIG hardened Ubuntu or RHEL base image",
  "SCAP 1.3 / XCCDF / OVAL benchmark bundle included",
  "FIPS 140-2 validated cryptographic modules",
  "Air-gap software update via signed bundle transfer",
  "Immutable audit log with WORM-compliant storage option",
  "CAC / PIV credential support via PACS integration",
  "Dedicated mission team for ATO support packages",
  "Classified network (SIPRNet / JWICS) architecture available",
];

export default function Federal() {
  return (
    <div className="dark min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />
      <main className="flex-1">

        <section className="py-24 border-b border-border/50">
          <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 text-primary text-sm font-mono mb-4">
                <ShieldCheck className="w-4 h-4" /> FEDERAL & DEFENSE
              </div>
              <h1 className="text-4xl font-bold tracking-tight mb-6 leading-tight">
                Zero Trust for DoD, IC,<br />and Federal Civilian Agencies
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed mb-8">
                SignalGrid is purpose-built for environments where software-only Zero Trust is insufficient. Physical custody binding, DISA STIG hardened deployment, air-gap capability, and CMMC-mapped policy controls — ready for classified and regulated government environments.
              </p>
              <div className="flex flex-wrap gap-3 mb-8">
                {["DISA STIG Available", "DoD IL2–IL5", "CMMC 2.0 L3", "Air-Gap Ready", "FedRAMP In Process", "ITAR Compliant"].map(b => (
                  <span key={b} className="text-xs font-mono px-2.5 py-1 rounded border border-primary/20 bg-primary/5 text-primary">{b}</span>
                ))}
              </div>
              <div className="flex gap-3">
                <a href="#" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors">Request ATO Package</a>
                <a href="#" className="px-5 py-2.5 border border-border rounded-md text-sm font-medium hover:border-primary/50 transition-colors">Download Security Brief</a>
              </div>
            </div>
          </div>
        </section>

        {/* Compliance status */}
        <section className="py-20 bg-zinc-950 border-b border-border/50">
          <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
            <h2 className="text-2xl font-bold tracking-tight mb-10">Compliance Status</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {COMPLIANCE_STATUS.map((item, idx) => {
                const meta = STATUS_META[item.status];
                const Icon = meta.icon;
                return (
                  <motion.div
                    key={item.framework}
                    initial={{ opacity: 0, y: 10 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: idx * 0.05 }}
                    className="bg-card border border-border rounded-lg p-5 flex gap-4"
                  >
                    <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${meta.color.split(" ")[0]}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-semibold text-sm">{item.framework}</span>
                        <span className={`text-xs font-mono px-1.5 py-0.5 rounded border ${meta.color}`}>{item.badge}</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{item.detail}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Air-gap deployment */}
        <section className="py-20 border-b border-border/50">
          <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
              <div>
                <h2 className="text-2xl font-bold tracking-tight mb-4">Air-Gapped Deployment</h2>
                <p className="text-muted-foreground mb-6 leading-relaxed">
                  For DoD, IC, and critical infrastructure environments that cannot tolerate any external network dependency. The SignalGrid decision engine runs entirely within the classified enclave — no phone-home, no cloud dependency, no exception.
                </p>
                <ul className="space-y-3">
                  {DEPLOYMENT_FEATURES.map(f => (
                    <li key={f} className="flex items-start gap-3 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-4">
                <div className="bg-card border border-border rounded-xl p-6 font-mono text-xs space-y-3">
                  <div className="text-muted-foreground uppercase tracking-widest mb-4">Deployment Architecture</div>
                  {[
                    { label: "Network Boundary", value: "Air-gap / JWICS / SIPRNet", color: "text-green-400" },
                    { label: "Data Sovereignty", value: "100% on-premise", color: "text-green-400" },
                    { label: "License Validation", value: "Offline · Signed bundle", color: "text-green-400" },
                    { label: "Update Path", value: "Signed air-gap transfer", color: "text-green-400" },
                    { label: "Audit Storage", value: "WORM-compliant on-site", color: "text-green-400" },
                    { label: "Crypto Module", value: "FIPS 140-2 Level 2", color: "text-primary" },
                    { label: "OS Baseline", value: "DISA STIG Ubuntu / RHEL", color: "text-primary" },
                    { label: "Container", value: "Podman rootless", color: "text-primary" },
                    { label: "Auth", value: "CAC / PIV + LDAP", color: "text-primary" },
                  ].map(row => (
                    <div key={row.label} className="flex justify-between border-b border-border/40 pb-2">
                      <span className="text-muted-foreground">{row.label}</span>
                      <span className={row.color}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Contracting */}
        <section className="py-20 bg-zinc-950">
          <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
            <h2 className="text-2xl font-bold tracking-tight mb-3">Contracting Vehicles</h2>
            <p className="text-muted-foreground mb-8">For procurement officers — current and planned acquisition paths.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {VEHICLES.map(v => {
                const meta = STATUS_META[v.status];
                const Icon = meta.icon;
                return (
                  <div key={v.name} className="bg-card border border-border rounded-lg p-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-semibold text-sm">{v.name}</span>
                      <Icon className={`w-4 h-4 ${meta.color.split(" ")[0]}`} />
                    </div>
                    <p className="text-xs text-muted-foreground">{v.desc}</p>
                  </div>
                );
              })}
            </div>
            <div className="mt-8 p-6 bg-card border border-border rounded-xl">
              <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
                <div className="flex-1">
                  <div className="text-sm font-semibold mb-1">Need a CAGE Code or DUNS?</div>
                  <div className="text-sm text-muted-foreground">Contact our Federal team for SAM.gov registration details, sole-source justification support, and IDIQ on-ramp information.</div>
                </div>
                <a href="#" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors shrink-0">Contact Federal Team</a>
              </div>
            </div>
          </div>
        </section>

      </main>
      <Footer />
    </div>
  );
}
