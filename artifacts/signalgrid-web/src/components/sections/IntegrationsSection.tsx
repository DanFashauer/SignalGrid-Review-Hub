import { motion } from "framer-motion";

export default function IntegrationsSection() {
  const mdmIntegrations = [
    "Fleet MDM", "Microsoft Intune", "Workspace ONE", 
    "Jamf Pro", "Hexnode UEM", "MaaS360", 
    "NinjaOne", "Ivanti Neurons", "Endpoint Central", "Tanium"
  ];
  
  const idpIntegrations = ["Entra ID", "Okta"];
  const itsmIntegrations = ["ServiceNow", "Jira Service Management"];

  return (
    <section className="py-24 bg-zinc-950 border-b border-border/50" id="integrations">
      <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-8">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight mb-4">Ecosystem Agnostic</h2>
            <p className="text-muted-foreground text-lg">
              We ingest signals from your existing infrastructure. 19 native integrations across Identity, MDM, and ITSM. No new agents required.
            </p>
          </div>
          <div className="font-mono text-sm px-4 py-2 rounded border border-border bg-card inline-flex self-start md:self-end">
            <span className="text-primary mr-2">{"{"}</span>
            API-FIRST ARCHITECTURE
            <span className="text-primary ml-2">{"}"}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="md:col-span-6 p-8 rounded-xl border border-border/50 bg-card/50"
          >
            <h3 className="text-sm font-medium tracking-widest text-muted-foreground uppercase mb-6">MDM / UEM / Posture</h3>
            <div className="flex flex-wrap gap-2">
              {mdmIntegrations.map((item) => (
                <span key={item} className="px-3 py-1.5 rounded-md border border-border bg-background text-sm font-medium text-foreground/80 hover:text-foreground transition-colors hover:border-primary/50">
                  {item}
                </span>
              ))}
            </div>
          </motion.div>

          <div className="md:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="p-8 rounded-xl border border-border/50 bg-card/50"
            >
              <h3 className="text-sm font-medium tracking-widest text-muted-foreground uppercase mb-6">Identity & Access</h3>
              <div className="flex flex-wrap gap-2">
                {idpIntegrations.map((item) => (
                  <span key={item} className="px-3 py-1.5 rounded-md border border-border bg-background text-sm font-medium text-foreground/80 hover:text-foreground transition-colors hover:border-primary/50">
                    {item}
                  </span>
                ))}
              </div>
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="p-8 rounded-xl border border-border/50 bg-card/50"
            >
              <h3 className="text-sm font-medium tracking-widest text-muted-foreground uppercase mb-6">ITSM & Ops</h3>
              <div className="flex flex-wrap gap-2">
                {itsmIntegrations.map((item) => (
                  <span key={item} className="px-3 py-1.5 rounded-md border border-border bg-background text-sm font-medium text-foreground/80 hover:text-foreground transition-colors hover:border-primary/50">
                    {item}
                  </span>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
