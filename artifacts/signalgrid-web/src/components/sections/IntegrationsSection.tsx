import { motion } from "framer-motion";

// Exercised against a REAL server, over the vendor's genuine protocol, by a
// committed proof lane. Fixture proofs remain the committed evidence:
//   Fleet   — real Fleet server + a real enrolled osqueryd agent over TLS (proof:live-fleet)
//   Traccar — real Traccar server over its genuine OsmAnd device protocol (proof:live-location)
const LIVE_VERIFIED = new Set(["Fleet", "Traccar"]);

const CATEGORY_GROUPS = [
  {
    label: "Identity & Access",
    items: ["Okta", "SailPoint", "Saviynt", "Entra ID", "Auth0", "Keycloak", "Imprivata", "Teleport", "Authentik", "ZITADEL"],
    owner: "IAM",
  },
  {
    label: "Endpoint & MDM",
    items: ["Intune", "Jamf Pro", "Kandji", "Workspace ONE", "Fleet", "CrowdStrike", "SentinelOne", "Mosyle", "Carbon Black", "Trellix"],
    owner: "Endpoint Mgmt / SOC",
  },
  {
    label: "Physical Access, Custody & Cellular",
    items: ["DockBridge (custody)", "Traccar", "HID Global", "LenelS2", "Genetec", "RF IDeas", "Verkada", "Honeywell Pro-Watch", "Twilio Super SIM", "Soracom", "C•CURE 9000"],
    owner: "Physical Security / NetOps",
  },
  {
    label: "SIEM, SOAR & Monitoring",
    items: ["Splunk", "Microsoft Sentinel", "Elastic Security", "Chronicle", "Tines", "Torq", "Datadog", "Grafana", "PagerDuty", "AWS EventBridge"],
    owner: "SOC / SRE",
  },
  {
    label: "DR / BC & GRC",
    items: ["Veeam", "Zerto", "Rubrik", "Qualys VMDR", "Tenable.io", "ServiceNow GRC", "Drata", "DISA SCAP/STIG", "RSA Archer", "Rapid7 InsightVM"],
    owner: "Business Continuity / GRC",
  },
];

export default function IntegrationsSection() {
  return (
    <section className="py-24 bg-zinc-950 border-b border-border/50" id="integrations">
      <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-8">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight mb-4">16 Candidate Source Categories Across Your Stack.</h2>
            <p className="text-muted-foreground text-lg">
              SignalGrid is designed to consume signals from across your security stack — identity, endpoint, physical access &amp; custody, SIEM, SOAR, DR, and GRC — and route every alert to the team that owns that signal source. These are the candidate source-category taxonomy (the core normalizes 17 signal categories today; see <a href="https://github.com/DanFashauer/SignalGrid-Review-Hub/blob/main/docs/WHAT_SIGNALGRID_DOES_TODAY.md" className="text-primary underline">what's evaluated today</a>). The vendors below are candidate categories, not live integrations; systems of record remain external.
            </p>
          </div>
          <div className="font-mono text-sm px-4 py-2 rounded border border-border bg-card inline-flex self-start md:self-end gap-2">
            <span className="text-primary">{"{"}</span>
            API-FIRST — NO NEW AGENTS
            <span className="text-primary">{"}"}</span>
          </div>
        </div>

        <div className="space-y-4">
          {CATEGORY_GROUPS.map((group, idx) => (
            <motion.div
              key={group.label}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.08 }}
              className="p-6 rounded-xl border border-border/50 bg-card/50"
            >
              <div className="flex items-center justify-between gap-4 mb-4">
                <h3 className="text-sm font-mono font-bold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </h3>
                <span className="text-xs font-mono px-2 py-0.5 rounded border border-primary/20 bg-primary/5 text-primary shrink-0">
                  OWNER: {group.owner}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {group.items.map((item) => (
                  <span
                    key={item}
                    className={
                      LIVE_VERIFIED.has(item)
                        ? "px-3 py-1.5 rounded-md border border-emerald-400/40 bg-emerald-400/5 text-sm font-medium text-foreground inline-flex items-center gap-2"
                        : "px-3 py-1.5 rounded-md border border-border bg-background text-sm font-medium text-foreground/80 hover:text-foreground hover:border-primary/50 transition-colors"
                    }
                  >
                    {item}
                    {LIVE_VERIFIED.has(item) && (
                      <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400">Live-verified</span>
                    )}
                  </span>
                ))}
                <span className="px-3 py-1.5 rounded-md border border-border/40 bg-background/50 text-sm font-mono text-muted-foreground/60">
                  + more
                </span>
              </div>
            </motion.div>
          ))}
        </div>

        <p className="mt-6 text-sm text-muted-foreground/70">
          <span className="font-mono text-xs uppercase tracking-wider text-emerald-400">Live-verified</span>{" "}
          means exercised against a real server by a committed proof lane — Fleet against a real
          Fleet server with a real enrolled osquery agent over TLS (<span className="font-mono">proof:live-fleet</span>),
          Traccar against a real Traccar server over its genuine device protocol
          (<span className="font-mono">proof:live-location</span>). Fixture proofs remain the
          committed evidence; every other chip is a candidate category, not an integration.
        </p>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
          className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4"
        >
          {[
            { value: "17", label: "Core signal categories" },
            { value: "16", label: "Candidate source categories (taxonomy)" },
            { value: String(new Set(CATEGORY_GROUPS.map(g => g.owner)).size), label: "Owning teams shown" },
            { value: "12+", label: "Frameworks mapped" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg border border-border bg-card p-5 text-center">
              <div className="text-2xl font-bold font-mono text-primary mb-1">{stat.value}</div>
              <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{stat.label}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
