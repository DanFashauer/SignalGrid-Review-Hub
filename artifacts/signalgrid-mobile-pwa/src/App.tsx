import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { ShieldCheck, Home, List, Activity, Plug } from "lucide-react";
import MyAccess from "@/pages/MyAccess";
import Overview from "@/pages/Overview";
import Decisions from "@/pages/Decisions";
import Signals from "@/pages/Signals";
import Integrations from "@/pages/Integrations";

const queryClient = new QueryClient();

function MainLayout() {
  // Default to the end-user (worker) surface; operators can switch to the
  // monitoring tabs. The one PWA serves both personas on iOS/Android.
  const [activeTab, setActiveTab] = useState("access");

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-background text-foreground overflow-hidden">
      <div className="flex-1 overflow-hidden relative">
        {activeTab === "access" && <MyAccess />}
        {activeTab === "overview" && <Overview />}
        {activeTab === "decisions" && <Decisions />}
        {activeTab === "signals" && <Signals />}
        {activeTab === "integrations" && <Integrations />}
      </div>

      <div className="h-14 shrink-0 bg-card border-t border-border flex items-center justify-around pb-safe">
        <TabButton icon={<ShieldCheck size={20} />} label="My Access" active={activeTab === "access"} onClick={() => setActiveTab("access")} />
        <TabButton icon={<Home size={20} />} label="Overview" active={activeTab === "overview"} onClick={() => setActiveTab("overview")} />
        <TabButton icon={<List size={20} />} label="Decisions" active={activeTab === "decisions"} onClick={() => setActiveTab("decisions")} />
        <TabButton icon={<Activity size={20} />} label="Signals" active={activeTab === "signals"} onClick={() => setActiveTab("signals")} />
        <TabButton icon={<Plug size={20} />} label="Integrations" active={activeTab === "integrations"} onClick={() => setActiveTab("integrations")} />
      </div>
    </div>
  );
}

function TabButton({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center justify-center w-full h-full space-y-1 active:scale-95 transition-transform ${active ? "text-primary" : "text-muted-foreground"}`}
    >
      {icon}
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MainLayout />
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
