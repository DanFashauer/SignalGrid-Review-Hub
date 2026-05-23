import { motion } from "framer-motion";

export default function VerticalsSection() {
  const verticals = [
    {
      name: "Healthcare",
      useCase: "Medication cart iPads & EHR/MAR workflows",
      detail: "HIPAA-adjacent device controls with rapid shift-handovers."
    },
    {
      name: "Logistics",
      useCase: "Shared Android barcode scanners",
      detail: "High-value inventory authorization tied to physical location."
    },
    {
      name: "Retail",
      useCase: "Shared POS terminals",
      detail: "Kiosk mode enforcement and inventory write workflow gating."
    },
    {
      name: "Enterprise IT",
      useCase: "Privileged configuration management",
      detail: "Engineer workstation integrity for prod environment access."
    },
    {
      name: "Financial Services",
      useCase: "Branch advisor tablets",
      detail: "Transaction authorization gated by strict after-hours policies."
    },
    {
      name: "Regulated Gov",
      useCase: "Air-gapped deployments",
      detail: "Zero external data transmission requirements met natively."
    }
  ];

  return (
    <section className="py-24 bg-background border-b border-border/50" id="use-cases">
      <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
        <div className="mb-16">
          <h2 className="text-3xl font-bold tracking-tight mb-4">Built for the Frontline</h2>
          <p className="text-muted-foreground text-lg max-w-2xl">
            Protecting the 30 million frontline workers who share devices across shifts requires a different architecture than protecting remote engineers.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {verticals.map((vertical, idx) => (
            <motion.div 
              key={vertical.name}
              initial={{ opacity: 0, scale: 0.98 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: idx * 0.05 }}
              className="p-6 rounded-xl border border-border bg-card/50 hover:bg-card hover:border-border/80 transition-all cursor-default"
            >
              <h3 className="text-lg font-semibold mb-2">{vertical.name}</h3>
              <div className="text-primary text-sm font-medium mb-3">{vertical.useCase}</div>
              <p className="text-sm text-muted-foreground leading-relaxed">{vertical.detail}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
