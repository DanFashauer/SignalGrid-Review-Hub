import { lazy, Suspense } from "react";
import { MotionConfig } from "framer-motion";
import { Switch, Route, Router as WouterRouter } from "wouter";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";

// The landing page ships eagerly; the secondary routes are code-split so the
// first paint only downloads Home's code instead of all five pages at once.
const Hardware = lazy(() => import("@/pages/Hardware"));
const Pricing = lazy(() => import("@/pages/Pricing"));
const Federal = lazy(() => import("@/pages/Federal"));
const Downloads = lazy(() => import("@/pages/Downloads"));
const About = lazy(() => import("@/pages/About"));

function Router() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/hardware" component={Hardware} />
        <Route path="/pricing" component={Pricing} />
        <Route path="/federal" component={Federal} />
        <Route path="/downloads" component={Downloads} />
        <Route path="/about" component={About} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    // `reducedMotion="user"` makes every framer-motion animation on the site
    // honour the visitor's prefers-reduced-motion setting in one place,
    // rather than per-component (and rather than not at all).
    <MotionConfig reducedMotion="user">
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <div className="dark min-h-screen bg-background text-foreground">
          <Router />
        </div>
      </WouterRouter>
    </MotionConfig>
  );
}

export default App;
