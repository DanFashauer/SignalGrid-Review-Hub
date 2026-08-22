import { motion } from "framer-motion";
import { ShieldCheck, Users, AlertTriangle, CheckCircle2 } from "lucide-react";

const FRAMEWORKS = [
  { name: "CIS Benchmarks", level: "CIS", desc: "Device hardening baselines + CIS Controls v8 safeguards — baseline drift becomes a decision signal", color: "text-emerald-400 border-emerald-400/20 bg-emerald-400/5" },
  { name: "DISA STIG", level: "DoD", desc: "CAT I/II/III hardening — maps SCAP/XCCDF checker results to posture signals", color: "text-teal-400 border-teal-400/20 bg-teal-400/5" },
  { name: "FedRAMP Moderate", level: "USG", desc: "NIST 800-53 Rev 5 control baseline for federal cloud deployments", color: "text-teal-400 border-teal-400/20 bg-teal-400/5" },
  { name: "FedRAMP High", level: "USG", desc: "High-impact federal workloads — expanded 800-53 control coverage", color: "text-teal-400 border-teal-400/20 bg-teal-400/5" },
  { name: "DoD IL2 – IL5", level: "DoD", desc: "Impact Level classification for DoD cloud workloads and CUI data", color: "text-teal-400 border-teal-400/20 bg-teal-400/5" },
  { name: "CMMC 2.0 L2/L3", level: "DoD", desc: "Cybersecurity Maturity Model Certification for defense contractors", color: "text-purple-400 border-purple-400/20 bg-purple-400/5" },
  { name: "NIST SP 800-53", level: "NIST", desc: "Security and privacy controls — full Rev 5 control mapping", color: "text-purple-400 border-purple-400/20 bg-purple-400/5" },
  { name: "NIST SP 800-171", level: "NIST", desc: "Protecting CUI in non-federal systems — 110-control baseline", color: "text-purple-400 border-purple-400/20 bg-purple-400/5" },
  { name: "SOC 2 Type II", level: "AICPA", desc: "Access-control and audit-trail signals map into the decision evidence; no attestation is held", color: "text-green-400 border-green-400/20 bg-green-400/5" },
  { name: "HIPAA / HITECH", level: "HHS", desc: "Access-control and audit-trail signal mapping — no PHI is processed and no attestation is held", color: "text-green-400 border-green-400/20 bg-green-400/5" },
  { name: "PCI DSS 4.0", level: "PCI SSC", desc: "Cardholder data environment access control and audit logging", color: "text-green-400 border-green-400/20 bg-green-400/5" },
  { name: "ISO 27001:2022", level: "ISO", desc: "Information security management system — Annex A control mapping", color: "text-amber-400 border-amber-400/20 bg-amber-400/5" },
  { name: "ITAR / EAR", level: "US Gov", desc: "Export control compliance for defense and dual-use technology", color: "text-amber-400 border-amber-400/20 bg-amber-400/5" },
];

const TEAM_ROUTING = [
  {
    team: "Physical Security",
    owns: ["Physical Access (PACS)", "IoT / Smart Building"],
    alerts: "Roadmap (deferred, not Limited GA): badge, door, and zone events route here when those signal families ship",
    color: "text-orange-400 bg-orange-400/10 border-orange-400/20",
  },
  {
    team: "SOC",
    owns: ["EDR / XDR", "SIEM", "SOAR / Automation"],
    alerts: "Threat detections, anomalous behavioral signals, playbook escalations, SIEM alert state changes",
    color: "text-red-400 bg-red-400/10 border-red-400/20",
  },
  {
    team: "IAM",
    owns: ["IGA / IDP", "Security Keys / FIDO2", "Mobile Credentials"],
    alerts: "Identity anomaly, MFA failure patterns, credential risk scores, badge credential revocation",
    color: "text-teal-400 bg-teal-400/10 border-teal-400/20",
  },
  {
    team: "Endpoint Mgmt",
    owns: ["MDM / UEM"],
    alerts: "Compliance drift, agent health failure, lost/stolen device reports, policy violation",
    color: "text-green-400 bg-green-400/10 border-green-400/20",
  },
  {
    team: "NetOps / NetSecOps",
    owns: ["Networking / SDN", "Firewall / SASE", "Cellular / eSIM"],
    alerts: "Network posture anomaly, eSIM connectivity loss, VLAN policy violation, firewall rule breach",
    color: "text-teal-400 bg-teal-400/10 border-teal-400/20",
  },
  {
    team: "SRE / Infra",
    owns: ["Infrastructure Monitoring", "Disaster Recovery / BC"],
    alerts: "RPO/RTO breach, replication lag, backup job failure, infrastructure health degradation",
    color: "text-purple-400 bg-purple-400/10 border-purple-400/20",
  },
  {
    team: "GRC",
    owns: ["GRC / Compliance"],
    alerts: "STIG finding severity, vulnerability remediation-deadline breach, control test failure, audit evidence gap",
    color: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  },
  {
    team: "IT Service Desk",
    owns: ["ITSM"],
    alerts: "Open incident escalation, change window conflicts, ticket response-time breach, on-call schedule gaps",
    color: "text-slate-400 bg-slate-400/10 border-slate-400/20",
  },
];

export default function ComplianceSection() {
  return (
    <section className="py-24 bg-zinc-950 border-b border-border/50" id="compliance">
      <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">

        {/* Header */}
        <div className="mb-16 max-w-3xl">
          <div className="inline-flex items-center gap-2 text-primary text-sm font-mono mb-4">
            <ShieldCheck className="w-4 h-4" />
            COMPLIANCE & GOVERNANCE
          </div>
          <h2 className="text-3xl font-bold tracking-tight mb-4">Designed for Regulated Environments. Signals Mapped to Major Frameworks.</h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            SignalGrid is designed toward regulated environments — it maps recognized framework signals (CIS, DISA STIG, NIST) into its decision evidence and logs every evaluation to a tamper-evident audit trail. SignalGrid is not presented as a compliance certification or attestation; the frameworks below are what it maps signals to, not certifications it holds.
          </p>
        </div>

        {/* Compliance framework grid */}
        <div className="mb-20">
          <div className="text-xs font-mono text-muted-foreground mb-4 uppercase tracking-wide">Frameworks we map signals to (not certifications held)</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {FRAMEWORKS.map((fw, idx) => (
              <motion.div
                key={fw.name}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: idx * 0.04 }}
                className={`rounded-lg border p-4 ${fw.color}`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-sm font-semibold text-foreground">{fw.name}</span>
                  <span className={`text-xs font-mono px-1.5 py-0.5 rounded border ${fw.color} shrink-0`}>{fw.level}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">{fw.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>

        {/* DISA / DoD callout */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-20 rounded-xl border border-teal-400/20 bg-teal-400/5 p-8"
        >
          <div className="flex flex-col lg:flex-row lg:items-center gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <ShieldCheck className="w-6 h-6 text-teal-400" />
                <h3 className="text-lg font-semibold text-foreground">Hardening baselines — CIS &amp; DISA STIG as decision signals</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                SignalGrid maps hardening-baseline results — CIS Benchmark alignment and SCAP/STIG (CAT I/II/III) finding state — into its decision evidence as a device security-baseline signal. A device that has drifted from its assigned baseline is stepped up or restricted at the moment a workflow fires. This is a candidate signal category modeled on public-safe fixtures; the source scanner remains the system of record.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:w-72 shrink-0">
              {[
                { label: "CAT I FINDINGS", value: "Block", desc: "Immediate DENY + alert" },
                { label: "CAT II FINDINGS", value: "Step-Up", desc: "Secondary verification" },
                { label: "CAT III FINDINGS", value: "Monitor", desc: "Logged, remediation flagged" },
                { label: "BENCHMARK", value: "XCCDF/OVAL", desc: "SCAP 1.3 compatible" },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-teal-400/20 bg-background/50 p-3">
                  <div className="text-xs font-mono text-muted-foreground mb-1">{item.label}</div>
                  <div className="text-sm font-semibold text-teal-400 font-mono">{item.value}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Team ownership routing */}
        <div>
          <div className="flex items-center gap-3 mb-8">
            <Users className="w-5 h-5 text-primary" />
            <div>
              <h3 className="text-xl font-bold tracking-tight">Ownership-Aware Alert Routing</h3>
              <p className="text-muted-foreground text-sm mt-1">
                Signal ownership is modeled per team, so an outcome can name the owning group — not a generic security inbox. Routing itself is a design, and no alerting is wired to external systems today.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {TEAM_ROUTING.map((team, idx) => (
              <motion.div
                key={team.team}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: idx * 0.06 }}
                className="rounded-lg border border-border bg-card p-5 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-mono font-semibold px-2 py-1 rounded border ${team.color}`}>
                    {team.team.toUpperCase()}
                  </span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {team.owns.map((cat) => (
                      <span key={cat} className="text-xs font-mono text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
                        {cat}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground leading-relaxed">{team.alerts}</p>
                </div>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="mt-6 flex items-start gap-3 p-4 rounded-lg border border-primary/20 bg-primary/5"
          >
            <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">
              Routing policies are defined in SignalGrid Policies and fully auditable. Each routing rule names the owning team and escalation path so the right engineers would see the right alerts without alert fatigue — the routing design is modeled today, and no alerting is wired to external systems.
            </p>
          </motion.div>
        </div>

      </div>
    </section>
  );
}
