import { Link } from "wouter";

const FOOTER_LINKS = {
  Product: [
    { label: "Hardware", href: "/hardware" },
    { label: "Platform", href: "/#platform" },
    { label: "Integrations", href: "#integrations" },
    { label: "Pricing", href: "/pricing" },
  ],
  Solutions: [
    { label: "Federal & DoD", href: "/federal" },
    { label: "Healthcare", href: "#use-cases" },
    { label: "Manufacturing", href: "#use-cases" },
    { label: "Retail & Distribution", href: "#use-cases" },
  ],
  Resources: [
    { label: "Documentation", href: "#" },
    { label: "API Reference", href: "/api/healthz" },
    { label: "Downloads", href: "/downloads" },
    { label: "Changelog", href: "#" },
  ],
  Company: [
    { label: "About", href: "#" },
    { label: "Blog", href: "#" },
    { label: "Careers", href: "#" },
    { label: "Contact", href: "#" },
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
              The runtime decision layer for Zero Trust enforcement in shared-device frontline environments.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {["FIPS 140-2", "CMMC L3", "DISA STIG"].map(b => (
                <span key={b} className="text-xs font-mono px-1.5 py-0.5 rounded border border-primary/20 bg-primary/5 text-primary/70">{b}</span>
              ))}
            </div>
          </div>

          {Object.entries(FOOTER_LINKS).map(([category, links]) => (
            <div key={category}>
              <h4 className="font-semibold text-foreground mb-4 text-sm">{category}</h4>
              <ul className="space-y-3 text-sm text-muted-foreground">
                {links.map(({ label, href }) => (
                  <li key={label}>
                    {href.includes("#") || href.startsWith("http") || href.startsWith("/api") ? (
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
          <div>&copy; {new Date().getFullYear()} SignalGrid, Inc. All rights reserved.</div>
          <div className="flex gap-6">
            <a href="https://github.com/DanFashauer/SignalGrid-Review-Hub" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Privacy Policy</a>
            <a href="https://github.com/DanFashauer/SignalGrid-Review-Hub" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Terms of Service</a>
            <a href="https://github.com/DanFashauer/SignalGrid-Review-Hub" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">System Status</a>
            <a href="/federal" className="hover:text-foreground transition-colors">FedRAMP</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
