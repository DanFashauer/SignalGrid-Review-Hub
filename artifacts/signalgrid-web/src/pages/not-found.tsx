import { Link } from "wouter";
import { Compass } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

/**
 * The public 404. It previously shipped the scaffold's developer copy — a
 * light-mode card asking "Did you forget to add the page to the router?" —
 * which every visitor who mistyped a URL was shown. A 404 is a wayfinding
 * surface, so it now says where the visitor is and offers the way back.
 */
export default function NotFound() {
  return (
    <div className="dark min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />
      <main className="flex-1 flex items-center justify-center">
        <div className="container mx-auto px-4 md:px-8 max-w-xl text-center py-24">
          <Compass className="w-10 h-10 text-primary mx-auto mb-6" aria-hidden="true" />
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-wide mb-3">
            404 — page not found
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-4">
            That page isn&rsquo;t here.
          </h1>
          <p className="text-muted-foreground leading-relaxed mb-8">
            The link may be out of date, or the address may have a typo. Everything
            published lives one step away.
          </p>
          <Link
            href="/"
            className="inline-block rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Back to the homepage
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
