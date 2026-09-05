import { Link } from "wouter";

const REPO = "https://github.com/DanFashauer/SignalGrid-Review-Hub";
const DOCS = `${REPO}/tree/SignalGrid_Alpha/docs`;

const FOOTER_LINKS = {
  Product: [
    { label: "Hardware", href: "/hardware" },
    { label: "Platform", href: "/#platform" },
    { label: "Integrations", href: "/#integrations" },
    { label: "Pricing", href: "/pricing" },
  ],
  Solutions: [
    { label: "Federal & DoD", href: "/federal" },
    { label: "Healthcare", href: "/#use-cases" },
    { label: "Manufacturing", href: "/#use-cases" },
    { label: "Retail & Distribution", href: "/#use-cases" },
  ],
  Resources: [
    { label: "Documentation", href: DOCS },
    { label: "API Reference", href: `${REPO}/blob/SignalGrid_Alpha/lib/api-spec/v1-openapi.yaml` },
    { label: "Downloads", href: "/downloads" },
    { label: "Changelog", href: `${REPO}/commits/SignalGrid_Alpha` },
  ],
  Company: [
    { label: "About", href: "/about" },
    { label: "Launch plan", href: `${REPO}/blob/SignalGrid_Alpha/docs/REALISTIC_LAUNCH_PLAN.md` },
    { label: "Security", href: `${REPO}/blob/SignalGrid_Alpha/SECURITY.md` },
    { label: "Contact", href: REPO },
  ],
};

export default function Footer() {
  return (
    <footer className="bg-background border-t border-border/40 py-12 md:py-16">
      <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 mb-12">

          <div className="col-span-2 lg:col-span-1 pr-8">
            <Link href="/" className="inline-flex items-center space-x-2 mb-4">
              <div className="h-5 w-5 rounded-sm bg-primary flex items-center justify-center">
                <div className="h-1.5 w-1.5 rounded-full bg-background" />
              </div>
              <span className="font-bold tracking-tight text-foreground">SIGNALGRID</span>
            </Link>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              The runtime decision layer for shared-device frontline environments — evidence in, one deterministic call out.
            </p>
            <p className="text-xs font-mono text-muted-foreground/70">
              Mapped to: FIPS 140-2 · CMMC L3 · DISA STIG (design targets, not certifications held)
            </p>
          </div>

          {Object.entries(FOOTER_LINKS).map(([category, links]) => (
            <div key={category}>
              <h4 className="font-semibold text-foreground mb-4 text-sm">{category}</h4>
              <ul className="space-y-3 text-sm text-muted-foreground">
                {links.map(({ label, href }) => (
                  <li key={label}>
                    {href.startsWith("http") ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">{label}</a>
                    ) : href.includes("#") ? (
                      <a href={href} className="hover:text-primary transition-colors">{label}</a>
                    ) : (
                      <Link href={href} className="hover:text-primary transition-colors">{label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="pt-8 border-t border-border/40 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <div>&copy; {new Date().getFullYear()} Daniel Fashauer. All rights reserved.</div>
          <div className="flex gap-6">
            <a href={`${REPO}/blob/SignalGrid_Alpha/docs/CI_AND_VALIDATION.md`} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Validation &amp; proofs</a>
            <Link href="/federal" className="hover:text-foreground transition-colors">FedRAMP</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
