import { motion } from "framer-motion";
import { ShieldCheck, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

// Pre-announcement posture. Badges describe how SignalGrid MAPS to each
// framework in its decision model, not certifications held or product
// availability. Everything here is modeled on public-safe fixtures.
const COMPLIANCE_STATUS = [
  { framework: "DISA STIG", status: "available", detail: "STIG-oriented base image · SCAP/XCCDF benchmark mapping · CAT I/II/III decision mapping", badge: "SIGNAL MAPPING" },
  { framework: "DoD IL2 – IL5", status: "in-progress", detail: "Air-gap-oriented architecture · no external data transmission by design · offline license model", badge: "DESIGN TARGET" },
  { framework: "CMMC 2.0 Level 3", status: "in-progress", detail: "NIST SP 800-171 controls mapped into the policy model across the practice domains", badge: "CONTROL MAPPING" },
  { framework: "FedRAMP Moderate", status: "planned", detail: "Authorization is a roadmap target that would require a separate, formal process — not claimed today", badge: "ROADMAP" },
  { framework: "FedRAMP High", status: "planned", detail: "Roadmap target following any Moderate authorization; air-gap deployment is the design path", badge: "PLANNED" },
  { framework: "NIST SP 800-53 Rev 5", status: "in-progress", detail: "Control-mapping document in progress · controls mapped into the policy model", badge: "CONTROL MAPPING" },
  { framework: "NIST SP 800-171", status: "in-progress", detail: "110-control baseline mapped · CUI handling modeled in the policy engine", badge: "CONTROL MAPPING" },
  { framework: "ITAR / EAR", status: "in-progress", detail: "Air-gap deployment is designed to keep data domestic; export-control posture is a design goal", badge: "DESIGN TARGET" },
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
  { name: "Direct Contract", desc: "Exploring direct-contract paths for design-partner engagements", status: "planned" },
];

const DEPLOYMENT_FEATURES = [
  "Zero external network connectivity — classified-enclave-oriented design",
  "Offline license model — no phone-home by design",
  "DISA STIG-oriented Ubuntu or RHEL base image",
  "SCAP 1.3 / XCCDF / OVAL benchmark mapping",
  "FIPS 140-2-oriented cryptographic module design",
  "Air-gap software update via signed bundle transfer",
  "Immutable audit log with WORM-style storage option",
  "CAC / PIV credential support (candidate PACS signal category)",
  "Design path for ATO support packages",
  "Classified-network (SIPRNet / JWICS) architecture design",
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
                SignalGrid is being designed for environments where software-only Zero Trust is insufficient: physical-custody binding, a STIG-oriented air-gap deployment path, and CMMC/NIST-mapped policy controls. This is a pre-announcement, fixture-backed design — not a certified, authorized, or available product.
              </p>
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-3 mb-8 text-sm text-muted-foreground">
                <span className="text-amber-400 font-medium">Pre-announcement:</span> framework references describe how signals map into the decision model, not certifications held or authorizations granted. No ATO, FedRAMP authorization, or availability is claimed.
              </div>
              <div className="flex flex-wrap gap-3 mb-8">
                {["DISA STIG-mapped", "DoD IL2–IL5 target", "CMMC 2.0 L3 mapping", "Air-gap-capable design", "FedRAMP-path (roadmap)", "ITAR-aware design"].map(b => (
                  <span key={b} className="text-xs font-mono px-2.5 py-1 rounded border border-primary/20 bg-primary/5 text-primary">{b}</span>
                ))}
              </div>
              <div className="flex gap-3">
                <a href="https://github.com/DanFashauer/SignalGrid-Review-Hub" target="_blank" rel="noopener noreferrer" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors">Request a conversation</a>
                <a href="https://github.com/DanFashauer/SignalGrid-Review-Hub/tree/main/docs" target="_blank" rel="noopener noreferrer" className="px-5 py-2.5 border border-border rounded-md text-sm font-medium hover:border-primary/50 transition-colors">Read the approach</a>
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
                  For DoD, IC, and critical-infrastructure environments that cannot tolerate an external network dependency, the SignalGrid decision engine is designed to run entirely within the classified enclave — no phone-home, no cloud dependency. This is the intended air-gap design, modeled on public-safe fixtures.
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
                  <div className="text-muted-foreground uppercase tracking-wide mb-4">Deployment Architecture</div>
                  {[
                    { label: "Network Boundary", value: "Air-gap / JWICS / SIPRNet", color: "text-green-400" },
                    { label: "Data Sovereignty", value: "100% on-premise", color: "text-green-400" },
                    { label: "License Validation", value: "Offline · Signed bundle", color: "text-green-400" },
                    { label: "Update Path", value: "Signed air-gap transfer", color: "text-green-400" },
                    { label: "Audit Storage", value: "WORM-style on-site", color: "text-green-400" },
                    { label: "Crypto Module", value: "FIPS 140-2-oriented", color: "text-primary" },
                    { label: "OS Baseline", value: "DISA STIG-oriented", color: "text-primary" },
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
                <a href="https://github.com/DanFashauer/SignalGrid-Review-Hub" target="_blank" rel="noopener noreferrer" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors shrink-0">Contact Federal Team</a>
              </div>
            </div>
          </div>
        </section>

      </main>
      <Footer />
    </div>
  );
}
