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
// Sessions is the product surface; it renders the same list component. See docs/PURPOSE.md.
const SessionList = DecisionList;
const Settings = named(() => import("@/pages/settings/Settings"), "Settings");
const DecisionDetail = named(() => import("@/pages/decisions/DecisionDetail"), "DecisionDetail");
const Audit = named(() => import("@/pages/Audit"), "Audit");
const Status = named(() => import("@/pages/Status"), "Status");
const ConnectorSetup = named(() => import("@/pages/ConnectorSetup"), "ConnectorSetup");
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

/**
 * The console IA law (P0 #239), enforced at the route table: the launch
 * wireframes end with "nothing else is launch UI", so every route OUTSIDE the
 * six launch screens renders this banner above its page. The sidebar's section
 * labels say the same thing, but a deep link bypasses the sidebar — the banner
 * cannot be bypassed. Fixture-preview and demo pages stay fully usable; they
 * just can never be mistaken for the shipped surface.
 */
function PreviewBanner() {
  return (
    <div className="px-8 pt-4">
      <div className="border border-amber-400/30 bg-amber-400/5 rounded px-3 py-2 font-mono text-[11px] text-amber-400/90">
        PREVIEW — fixture-backed demo surface, not part of the launch console.
        The launch surfaces are Overview, Decisions, Audit, Connector setup,
        Policies, and Assurance.
      </div>
    </div>
  );
}

// Wrapped once at module level so route components keep a stable identity
// across renders (an inline wrapper would remount the page on every render).
const preview = (Page: ComponentType) => {
  function PreviewPage() {
    return (
      <>
        <PreviewBanner />
        <Page />
      </>
    );
  }
  return PreviewPage;
};
const IntegrationListPreview = preview(IntegrationList);
const IntegrationDetailPreview = preview(IntegrationDetail);
const PolicyCreatePreview = preview(PolicyCreate);
const SignalListPreview = preview(SignalList);
const FleetPreview = preview(Fleet);
const AppWorkflowsPreview = preview(AppWorkflows);
const IntelligencePreview = preview(Intelligence);
const ProvisioningPreview = preview(Provisioning);
const AppResiliencePreview = preview(AppResilience);
const SignalSourcingPreview = preview(SignalSourcing);
const GridConfigPreview = preview(GridConfig);
const GridOverviewPreview = preview(GridOverview);
const SystemHealthPreview = preview(SystemHealth);

function Router() {
  return (
    <AppLayout>
      <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}>
        <Switch>
          {/* ── Launch console — the six wireframe screens, bound to /v1 ── */}
          {/*
            Sessions is the product and the default destination. Opening a
            session renders its Decision Envelope — there is deliberately no
            first-class Decisions destination, because a session produces an
            envelope and two peer destinations would raise "is a session
            different from a decision?" with no good answer. See docs/PURPOSE.md.

            /decisions is retained as a compatibility alias so existing deep
            links keep working; it is not advertised in navigation.
          */}
          <Route path="/" component={SessionList} />
          <Route path="/sessions" component={SessionList} />
          <Route path="/sessions/:id" component={DecisionDetail} />
          <Route path="/decisions" component={SessionList} />
          <Route path="/decisions/:id" component={DecisionDetail} />
          <Route path="/settings" component={Settings} />
          <Route path="/overview" component={Dashboard} />
          <Route path="/audit" component={Audit} />
          <Route path="/status" component={Status} />
          <Route path="/connectors/setup" component={ConnectorSetup} />
          <Route path="/policies" component={PolicyList} />
          <Route path="/policies/new" component={PolicyCreatePreview} />
          {/* /policies/new is preview: policy EDITING is off the launch fence —
              changes ride the repository. The read pages above are launch. */}
          <Route path="/policies/:id" component={PolicyDetail} />
          {/* ── Everything below is preview — labelled, never launch UI ── */}
          <Route path="/integrations" component={IntegrationListPreview} />
          <Route path="/integrations/:id" component={IntegrationDetailPreview} />
          <Route path="/signals" component={SignalListPreview} />
          <Route path="/fleet" component={FleetPreview} />
          <Route path="/app-workflows" component={AppWorkflowsPreview} />
          <Route path="/intelligence" component={IntelligencePreview} />
          <Route path="/provisioning" component={ProvisioningPreview} />
          <Route path="/app-resilience" component={AppResiliencePreview} />
          <Route path="/signal-sourcing" component={SignalSourcingPreview} />
          <Route path="/grid-config" component={GridConfigPreview} />
          <Route path="/grid" component={GridOverviewPreview} />
          <Route path="/system-health" component={SystemHealthPreview} />
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
