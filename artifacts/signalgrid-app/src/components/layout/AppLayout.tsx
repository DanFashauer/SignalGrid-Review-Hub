import React from "react";
import { Link, useLocation } from "wouter";
import {
  Activity,
  ShieldAlert,
  Settings,
  Network,
  Database,
  Server,
  Grid,
  AppWindow,
  Sparkles,
  MonitorSmartphone,
  HeartPulse,
  Radio,
  FileCode,
  LayoutGrid
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarProvider,
  SidebarFooter
} from "@/components/ui/sidebar";
import { useHealthCheck } from "@workspace/api-client-react";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: health } = useHealthCheck();

  const isHealthy = health?.status === "ok";

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
        <Sidebar className="border-r border-border bg-sidebar">
          <SidebarHeader className="p-4 flex items-center gap-2">
            <Grid className="w-6 h-6 text-primary" />
            <span className="font-bold text-lg tracking-tight font-mono">SIGNALGRID</span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-amber-400/30 bg-amber-400/5 text-amber-400/90 ml-auto">FIXTURE</span>
          </SidebarHeader>
          <SidebarContent>
            <SidebarMenu className="px-2 gap-1">
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/"}>
                  <Link href="/">
                    <Activity className="w-4 h-4 mr-2" />
                    <span>Overview</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.startsWith("/decisions")}>
                  <Link href="/decisions">
                    <ShieldAlert className="w-4 h-4 mr-2" />
                    <span>Decisions</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.startsWith("/audit")}>
                  <Link href="/audit">
                    <ShieldAlert className="w-4 h-4 mr-2" />
                    <span>Audit</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.startsWith("/signals")}>
                  <Link href="/signals">
                    <Activity className="w-4 h-4 mr-2" />
                    <span>Signals</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.startsWith("/integrations")}>
                  <Link href="/integrations">
                    <Network className="w-4 h-4 mr-2" />
                    <span>Integrations</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.startsWith("/policies")}>
                  <Link href="/policies">
                    <Settings className="w-4 h-4 mr-2" />
                    <span>Policies</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.startsWith("/fleet")}>
                  <Link href="/fleet">
                    <Server className="w-4 h-4 mr-2" />
                    <span>Fleet &amp; tenants</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.startsWith("/app-workflows")}>
                  <Link href="/app-workflows">
                    <AppWindow className="w-4 h-4 mr-2" />
                    <span>App workflows</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <div className="px-4 pt-4 pb-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">Build the grid</div>
            <SidebarMenu className="px-2 gap-1">
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/grid"}>
                  <Link href="/grid">
                    <LayoutGrid className="w-4 h-4 mr-2" />
                    <span>Grid overview</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.startsWith("/intelligence")}>
                  <Link href="/intelligence">
                    <Sparkles className="w-4 h-4 mr-2" />
                    <span>Grid intelligence</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.startsWith("/provisioning")}>
                  <Link href="/provisioning">
                    <MonitorSmartphone className="w-4 h-4 mr-2" />
                    <span>Device recorder</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.startsWith("/app-resilience")}>
                  <Link href="/app-resilience">
                    <HeartPulse className="w-4 h-4 mr-2" />
                    <span>App resilience</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.startsWith("/signal-sourcing")}>
                  <Link href="/signal-sourcing">
                    <Radio className="w-4 h-4 mr-2" />
                    <span>Signal sourcing</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.startsWith("/grid-config")}>
                  <Link href="/grid-config">
                    <FileCode className="w-4 h-4 mr-2" />
                    <span>Grid config</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.startsWith("/system-health")}>
                  <Link href="/system-health">
                    <Activity className="w-4 h-4 mr-2" />
                    <span>System health</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
          <SidebarFooter className="p-4 border-t border-border">
            <div className="flex items-center gap-2 text-xs font-mono">
              <div className={`w-2 h-2 rounded-full ${isHealthy ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-muted-foreground">API: {isHealthy ? 'Operational' : 'Degraded'}</span>
            </div>
          </SidebarFooter>
        </Sidebar>
        <main className="flex-1 overflow-y-auto bg-background">
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
