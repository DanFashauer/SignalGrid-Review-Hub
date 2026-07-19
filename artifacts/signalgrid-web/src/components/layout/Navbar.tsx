import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X } from "lucide-react";

const NAV_LINKS = [
  { href: "/hardware", label: "Hardware" },
  { href: "/pricing", label: "Pricing" },
  { href: "/federal", label: "Federal" },
  { href: "/downloads", label: "Downloads" },
  { href: "/about", label: "About" },
];

export default function Navbar() {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 max-w-screen-2xl items-center px-4 md:px-8">

        {/* Logo */}
        <div className="mr-6 flex items-center shrink-0">
          <Link href="/" className="flex items-center space-x-2">
            <div className="h-6 w-6 rounded-sm bg-primary flex items-center justify-center">
              <div className="h-2 w-2 rounded-full bg-background" />
            </div>
            <span className="font-bold tracking-tight hidden sm:inline-block">SIGNALGRID</span>
          </Link>
        </div>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1 text-sm flex-1">
          {/* Platform dropdown anchor */}
          <a
            href="/#platform"
            className="px-3 py-1.5 text-foreground/60 hover:text-foreground rounded transition-colors"
          >
            Platform
          </a>
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`px-3 py-1.5 rounded transition-colors ${
                location === href
                  ? "text-foreground font-medium"
                  : "text-foreground/60 hover:text-foreground"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* Right side CTAs */}
        <div className="hidden md:flex items-center gap-2 ml-auto shrink-0">
          <Link
            href="/downloads"
            className="px-4 py-1.5 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground rounded-md transition-colors"
          >
            App Suite
          </Link>
          <Link
            href="/hardware"
            className="px-4 py-1.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors"
          >
            Request Access
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden ml-auto p-2 rounded-md text-foreground/60 hover:text-foreground"
          onClick={() => setMobileOpen(o => !o)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div id="mobile-nav" className="md:hidden border-t border-border/40 bg-background px-4 py-4 space-y-1">
          <a href="/#platform" className="block px-3 py-2 text-sm rounded hover:bg-muted text-foreground/70" onClick={() => setMobileOpen(false)}>Platform</a>
          {NAV_LINKS.map(({ href, label }) => (
            <Link key={href} href={href} className="block px-3 py-2 text-sm rounded hover:bg-muted text-foreground/70" onClick={() => setMobileOpen(false)}>{label}</Link>
          ))}
          <div className="pt-3 border-t border-border/40 flex gap-2">
            <Link href="/downloads" className="flex-1 text-center py-2 text-sm border border-border rounded-md" onClick={() => setMobileOpen(false)}>App Suite</Link>
            <Link href="/hardware" className="flex-1 text-center py-2 text-sm bg-primary text-primary-foreground rounded-md" onClick={() => setMobileOpen(false)}>Request Access</Link>
          </div>
        </div>
      )}
    </header>
  );
}
