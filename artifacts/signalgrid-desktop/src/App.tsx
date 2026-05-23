import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import DesktopLayout from "@/components/DesktopLayout";
import DashboardPage from "@/pages/Dashboard";
import DecisionsPage from "@/pages/Decisions";
import SignalsPage from "@/pages/Signals";
import PoliciesPage from "@/pages/Policies";
import IntegrationsPage from "@/pages/Integrations";
import HandoffPage from "@/pages/Handoff";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchInterval: 8000, staleTime: 5000 } },
});

function Router() {
  return (
    <DesktopLayout>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/decisions" component={DecisionsPage} />
        <Route path="/signals" component={SignalsPage} />
        <Route path="/integrations" component={IntegrationsPage} />
        <Route path="/policies" component={PoliciesPage} />
        <Route path="/handoff" component={HandoffPage} />
        <Route component={NotFound} />
      </Switch>
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
