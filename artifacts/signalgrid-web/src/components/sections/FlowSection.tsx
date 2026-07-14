import { motion } from "framer-motion";
import { Radio, Grid3x3, MousePointerClick } from "lucide-react";

/**
 * The core concept, stated simply: a signal fires, the grid decides, and the
 * person chooses the action. This is the anchor of the site — everything else
 * is detail beneath it.
 */
const STEPS = [
  {
    tag: "SIGNAL",
    icon: Radio,
    title: "A signal fires",
    body: "The moment a workflow starts, the evidence arrives — identity, device posture, physical custody, and security baseline.",
    accent: "text-blue-400",
    ring: "ring-blue-400/30",
    glow: "bg-blue-400/10",
  },
  {
    tag: "GRID",
    icon: Grid3x3,
    title: "The grid decides",
    body: "SignalGrid fuses every signal into one clear call — allow, step-up, restrict, or deny — with the evidence and reason attached.",
    accent: "text-primary",
    ring: "ring-primary/30",
    glow: "bg-primary/10",
  },
  {
    tag: "ACTION",
    icon: MousePointerClick,
    title: "You choose the action",
    body: "The outcome routes to a one-tap self-service fix or an approval. You decide what happens next — your systems of record stay in place.",
    accent: "text-emerald-400",
    ring: "ring-emerald-400/30",
    glow: "bg-emerald-400/10",
  },
];

export default function FlowSection() {
  return (
    <section className="relative overflow-hidden border-b border-border/50 bg-background py-24" id="flow">
      <div className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[400px] w-[700px] -translate-x-1/2 rounded-full bg-primary/10 opacity-40 blur-[120px]" />

      <div className="container mx-auto max-w-screen-xl px-4 md:px-8">
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 font-mono text-xs text-primary">
            SIGNAL → GRID → ACTION
          </div>
          <h2 className="text-balance text-3xl font-bold leading-tight tracking-tight md:text-5xl">
            A signal fires. The grid decides.
            <br className="hidden sm:block" />{" "}
            <span className="bg-gradient-to-r from-blue-400 via-primary to-emerald-400 bg-clip-text text-transparent">
              You choose what happens next.
            </span>
          </h2>
          <p className="mt-6 text-pretty text-lg leading-relaxed text-muted-foreground">
            That is the whole idea. A signal, then an action — and the grid is what keeps it all
            together. SignalGrid never takes the decision away from you; it makes the right one obvious.
          </p>
        </div>

        {/* Flow */}
        <div className="relative grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-4">
          {/* Connecting line (desktop) */}
          <div className="pointer-events-none absolute left-0 right-0 top-[3.25rem] hidden h-px bg-gradient-to-r from-blue-400/40 via-primary/40 to-emerald-400/40 md:block" />

          {STEPS.map((step, i) => (
            <motion.div
              key={step.tag}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: i * 0.12 }}
              className="relative flex flex-col items-center text-center md:items-start md:text-left"
            >
              <div className={`relative mb-6 flex h-[6.5rem] w-full items-center justify-center md:justify-start`}>
                <div className={`relative flex h-24 w-24 items-center justify-center rounded-2xl bg-card ring-1 ${step.ring}`}>
                  <div className={`absolute inset-0 rounded-2xl ${step.glow} blur-xl`} />
                  <step.icon className={`relative h-9 w-9 ${step.accent}`} strokeWidth={1.75} />
                </div>
              </div>

              <div className={`mb-2 font-mono text-xs tracking-widest ${step.accent}`}>
                {String(i + 1).padStart(2, "0")} · {step.tag}
              </div>
              <h3 className="mb-3 text-xl font-semibold text-foreground">{step.title}</h3>
              <p className="max-w-sm text-pretty leading-relaxed text-muted-foreground">{step.body}</p>
            </motion.div>
          ))}
        </div>

        <p className="mx-auto mt-16 max-w-2xl text-center text-sm text-muted-foreground/70">
          Deterministic and fixture-backed today. Every high-risk action stays approval-gated and
          simulated — SignalGrid recommends and records; the choice is always yours.
        </p>
      </div>
    </section>
  );
}
