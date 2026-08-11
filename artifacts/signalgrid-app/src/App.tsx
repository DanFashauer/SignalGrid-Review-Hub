import { lazy, Suspense, type ComponentType } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Route-level code splitting: each page (and its heavy deps, e.g. the charting
// library on the dashboard) loads on demand instead of in one monolithic bundle.
const named = (loader: () => Promise<Record<string, unknown>>, key: string) =>
  lazy(() => loader().then((m) => ({ default: m[key] as ComponentType })));
const Dashboard = named(() => import("@/pages/Dashboard"), "Dashboard");
const DecisionList = named(() => import("@/pages/decisions/DecisionList"), "DecisionList");
const DecisionDetail = named(() => import("@/pages/decisions/DecisionDetail"), "DecisionDetail");
const Audit = named(() => import("@/pages/Audit"), "Audit");
const Status = named(() => import("@/pages/Status"), "Status");
const IntegrationList = named(() => import("@/pages/integrations/IntegrationList"), "IntegrationList");
const IntegrationDetail = named(() => import("@/pages/integrations/IntegrationDetail"), "IntegrationDetail");
const PolicyList = named(() => import("@/pages/policies/PolicyList"), "PolicyList");
const PolicyCreate = named(() => import("@/pages/policies/PolicyCreate"), "PolicyCreate");
const PolicyDetail = named(() => import("@/pages/policies/PolicyDetail"), "PolicyDetail");
const SignalList = named(() => import("@/pages/signals/SignalList"), "SignalList");
const Fleet = named(() => import("@/pages/Fleet"), "Fleet");
const AppWorkflows = named(() => import("@/pages/AppWorkflows"), "AppWorkflows");
const Intelligence = named(() => import("@/pages/Intelligence"), "Intelligence");
const Provisioning = named(() => import("@/pages/Provisioning"), "Provisioning");
const AppResilience = named(() => import("@/pages/AppResilience"), "AppResilience");
const SignalSourcing = named(() => import("@/pages/SignalSourcing"), "SignalSourcing");
const GridConfig = named(() => import("@/pages/GridConfig"), "GridConfig");
const GridOverview = named(() => import("@/pages/GridOverview"), "GridOverview");
const SystemHealth = named(() => import("@/pages/SystemHealth"), "SystemHealth");

const queryClient = new QueryClient();

function Router() {
  return (
    <AppLayout>
      <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/decisions" component={DecisionList} />
          <Route path="/decisions/:id" component={DecisionDetail} />
          <Route path="/audit" component={Audit} />
          <Route path="/status" component={Status} />
          <Route path="/integrations" component={IntegrationList} />
          <Route path="/integrations/:id" component={IntegrationDetail} />
          <Route path="/policies" component={PolicyList} />
          <Route path="/policies/new" component={PolicyCreate} />
          <Route path="/policies/:id" component={PolicyDetail} />
          <Route path="/signals" component={SignalList} />
          <Route path="/fleet" component={Fleet} />
          <Route path="/app-workflows" component={AppWorkflows} />
          <Route path="/intelligence" component={Intelligence} />
          <Route path="/provisioning" component={Provisioning} />
          <Route path="/app-resilience" component={AppResilience} />
          <Route path="/signal-sourcing" component={SignalSourcing} />
          <Route path="/grid-config" component={GridConfig} />
          <Route path="/grid" component={GridOverview} />
          <Route path="/system-health" component={SystemHealth} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </AppLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
