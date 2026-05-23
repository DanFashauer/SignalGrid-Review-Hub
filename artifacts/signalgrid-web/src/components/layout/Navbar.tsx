import { Link } from "wouter";

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 max-w-screen-2xl items-center px-4 md:px-8">
        <div className="mr-4 flex">
          <Link href="/" className="mr-6 flex items-center space-x-2">
            <div className="h-6 w-6 rounded-sm bg-primary flex items-center justify-center">
              <div className="h-2 w-2 rounded-full bg-background" />
            </div>
            <span className="hidden font-bold sm:inline-block tracking-tight">
              SIGNALGRID
            </span>
          </Link>
          <nav className="flex items-center space-x-6 text-sm font-medium">
            <a href="#platform" className="transition-colors hover:text-foreground/80 text-foreground/60">Platform</a>
            <a href="#integrations" className="transition-colors hover:text-foreground/80 text-foreground/60">Integrations</a>
            <a href="#use-cases" className="transition-colors hover:text-foreground/80 text-foreground/60">Use Cases</a>
            <a href="#deployment" className="transition-colors hover:text-foreground/80 text-foreground/60">Docs</a>
          </nav>
        </div>
        <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
          <div className="w-full flex-1 md:w-auto md:flex-none">
          </div>
          <nav className="flex items-center space-x-2">
            <a href="#" className="px-4 py-2 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground rounded-md transition-colors">
              Sign In
            </a>
            <a href="#" className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors">
              Request Access
            </a>
          </nav>
        </div>
      </div>
    </header>
  );
}
