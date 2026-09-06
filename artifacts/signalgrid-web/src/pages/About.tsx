import { motion } from "framer-motion";
import { GithubIcon, LinkedinIcon } from "@/components/ui/brand-icons";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

const VALUES = [
  "Trust is earned, never assumed.",
  "Security without workflow friction.",
  "Operational clarity over tool sprawl.",
  "Real-world context matters.",
  "Build for resilience and accountability.",
];

const PILLARS = [
  { name: "Identity", body: "Tie access decisions to real users and roles." },
  { name: "Trust", body: "Evaluate device and session trust continuously, not by assumption." },
  { name: "Context", body: "Include device posture and operational state in decisions today; location and custody context are design targets on the roadmap, not Limited GA." },
  { name: "Outcome", body: "Produce a deterministic allow / step-up / restrict / deny with evidence attached; approved actions are routed to the systems of record, never executed by SignalGrid." },
  { name: "Governance", body: "Keep decisions auditable, explainable, and reviewable." },
];

const IS = [
  "A trust-orchestration layer for access decisions on shared and mobile devices.",
  "A session decision platform combining identity, device posture, and operational context (location and custody are roadmap, not Limited GA).",
  "An evidence and governance layer designed to sit alongside connected systems (NAC, SIEM, ITSM) — each remains the system of record; none is a Limited GA connector.",
];
const IS_NOT = [
  "A replacement for your identity provider.",
  "A replacement for MDM/UEM device management.",
  "A replacement for NAC, SIEM, or ITSM platforms.",
  "A generic badge app or shared-device prototype.",
];

export default function About() {
  return (
    <div className="dark min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />
      <main className="flex-1">
        {/* Mission */}
        <section className="py-24 border-b border-border/50">
          <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 text-primary text-sm font-mono mb-4">
                ABOUT SIGNALGRID
              </div>
              <h1 className="text-4xl font-bold tracking-tight mb-6 leading-tight">
                The closed-loop decision layer for access risk.
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed mb-4">
                SignalGrid connects the systems a shared and mobile work environment
                already runs — access control, identity, device management, location,
                applications — into one grid that decides. It enables secure, contextual,
                real-time access by continuously evaluating identity, device trust, and
                operational context.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Authentication proves identity. SignalGrid ensures the system is actually capable
                of operating before access is granted — it sits between identity, device
                management, and operational workflows to make trust decisions at the moment of use.
              </p>
            </div>
          </div>
        </section>

        {/* Pillars */}
        <section className="py-20 border-b border-border/50 bg-card/30">
          <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
            <h2 className="text-2xl font-bold tracking-tight mb-10">How it works</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              {PILLARS.map((p, i) => (
                <motion.div
                  key={p.name}
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.06 }}
                  className="rounded-xl border border-border/50 bg-card/50 p-5"
                >
                  <div className="text-sm font-mono font-semibold text-primary mb-2">{p.name}</div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{p.body}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Who we serve + values */}
        <section className="py-20 border-b border-border/50">
          <div className="container mx-auto px-4 md:px-8 max-w-screen-xl grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div>
              <h2 className="text-2xl font-bold tracking-tight mb-4">Who we serve</h2>
              <p className="text-muted-foreground leading-relaxed">
                Organizations with regulated or high-consequence frontline operations that rely on
                shared or mobile devices — including healthcare systems, logistics operators, and
                similar environments where real-time access decisions must be secure and auditable.
              </p>
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight mb-4">What we believe</h2>
              <ul className="space-y-2.5">
                {VALUES.map((v) => (
                  <li key={v} className="flex items-start gap-2.5 text-muted-foreground">
                    <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                    {v}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Is / is not */}
        <section className="py-20 border-b border-border/50 bg-card/30">
          <div className="container mx-auto px-4 md:px-8 max-w-screen-xl grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-6">
              <h3 className="font-semibold mb-4 text-primary">SignalGrid is</h3>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                {IS.map((s) => <li key={s}>· {s}</li>)}
              </ul>
            </div>
            <div className="rounded-xl border border-border/50 bg-background/50 p-6">
              <h3 className="font-semibold mb-4 text-foreground/80">SignalGrid is not</h3>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                {IS_NOT.map((s) => <li key={s}>· {s}</li>)}
              </ul>
            </div>
          </div>
        </section>

        {/* Founder */}
        <section className="py-20">
          <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 text-primary text-sm font-mono mb-4">
                FOUNDER
              </div>
              <h2 className="text-2xl font-bold tracking-tight mb-4">Daniel Fashauer</h2>
              <p className="text-muted-foreground leading-relaxed mb-6">
                Founder and builder of SignalGrid — bringing runtime trust decisioning to shared and
                mobile frontline environments, where authentication alone doesn&apos;t guarantee a
                session is safe to start.
              </p>
              <div className="flex gap-3">
                <a
                  href="https://www.linkedin.com/in/daniel-fashauer-a0148278"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-border text-sm hover:border-primary/50 transition-colors"
                >
                  <LinkedinIcon className="w-4 h-4" /> LinkedIn
                </a>
                <a
                  href="https://github.com/DanFashauer"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-border text-sm hover:border-primary/50 transition-colors"
                >
                  <GithubIcon className="w-4 h-4" /> GitHub
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
