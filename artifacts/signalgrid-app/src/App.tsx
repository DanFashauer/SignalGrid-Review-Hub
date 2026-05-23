import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout/AppLayout";
import { Dashboard } from "@/pages/Dashboard";
import { DecisionList } from "@/pages/decisions/DecisionList";
import { DecisionDetail } from "@/pages/decisions/DecisionDetail";
import { IntegrationList } from "@/pages/integrations/IntegrationList";
import { IntegrationDetail } from "@/pages/integrations/IntegrationDetail";
import { PolicyList } from "@/pages/policies/PolicyList";
import { PolicyCreate } from "@/pages/policies/PolicyCreate";
import { PolicyDetail } from "@/pages/policies/PolicyDetail";
import { SignalList } from "@/pages/signals/SignalList";

const queryClient = new QueryClient();

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/decisions" component={DecisionList} />
        <Route path="/decisions/:id" component={DecisionDetail} />
        <Route path="/integrations" component={IntegrationList} />
        <Route path="/integrations/:id" component={IntegrationDetail} />
        <Route path="/policies" component={PolicyList} />
        <Route path="/policies/new" component={PolicyCreate} />
        <Route path="/policies/:id" component={PolicyDetail} />
        <Route path="/signals" component={SignalList} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
