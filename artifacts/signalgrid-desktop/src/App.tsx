import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import DesktopLayout from "@/components/DesktopLayout";

// Route-level code splitting keeps the desktop shell light; each page (and the
// charting library on the dashboard) loads on demand.
const DashboardPage = lazy(() => import("@/pages/Dashboard"));
const DecisionsPage = lazy(() => import("@/pages/Decisions"));
const SignalsPage = lazy(() => import("@/pages/Signals"));
const PoliciesPage = lazy(() => import("@/pages/Policies"));
const IntegrationsPage = lazy(() => import("@/pages/Integrations"));
const HandoffPage = lazy(() => import("@/pages/Handoff"));

// Fixture data doesn't change between polls, so a gentle 30s cadence is plenty
// (was an aggressive 8s that churned the network for a static demo).
const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchInterval: 30_000, staleTime: 20_000 } },
});

function Router() {
  return (
    <DesktopLayout>
      <Suspense fallback={<div className="p-6 text-xs font-mono text-muted-foreground">Loading…</div>}>
        <Switch>
          <Route path="/" component={DashboardPage} />
          <Route path="/decisions" component={DecisionsPage} />
          <Route path="/signals" component={SignalsPage} />
          <Route path="/integrations" component={IntegrationsPage} />
          <Route path="/policies" component={PoliciesPage} />
          <Route path="/handoff" component={HandoffPage} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </DesktopLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <div className="dark min-h-screen bg-background text-foreground overflow-hidden">
            <Router />
          </div>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
