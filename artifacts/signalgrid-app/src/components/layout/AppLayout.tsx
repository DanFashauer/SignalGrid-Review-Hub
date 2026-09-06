import React from "react";
import { Link, useLocation } from "wouter";
import {
  Activity,
  ShieldAlert,
  Settings,
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

/**
 * The console IA (P0 #239): the sidebar states which surfaces ARE the launch
 * console and which are not, instead of presenting breadth as product. Three
 * groups, matching the launch wireframes' closing line — "nothing else is
 * launch UI":
 *   · Launch console — the six wireframe screens, bound to the served /v1 API.
 *   · Fixture previews — real pages on the in-browser fixtures client;
 *     labelled so a partner can never mistake them for the shipped surface.
 *   · Build the grid — capability demos for deferred families; same rule.
 * Every non-launch route also renders the PreviewBanner (see App.tsx), so the
 * label survives deep links that bypass this sidebar.
 */

type NavEntry = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; match?: string };

/**
 * Primary navigation — docs/PURPOSE.md (DR-019).
 *
 * The semantic invariant, and the answer whenever ownership is ambiguous:
 *
 *   Session          the operational event
 *   Decision Envelope the transaction produced for that event
 *   DecisionOutcome   the verdict inside the envelope
 *
 * So there is deliberately NO first-class "Decisions" destination. A separate
 * one immediately raises "is a session different from a decision?", and there is
 * no good answer. A session produces an envelope; opening the session renders it.
 *
 * Sessions and Policies are primary because an operator governs policy
 * independently of any individual session. Everything else — sources,
 * connectors, integrations, fleet, tenants — is configuration and lives under
 * Settings. Devices are entities involved in sessions, reachable by search and
 * from session context, not a peer of the product itself.
 */
// Exported so the PreviewBanner (App.tsx) derives its "launch surfaces are …"
// sentence from the SAME array that is rendered here — the banner cannot drift
// from the nav. Configuration surfaces (sources, connectors, integrations,
// fleet, assurance, audit) are reached THROUGH Settings (see pages/settings)
// and are deliberately not primary navigation, so there is no SETTINGS_NAV: a
// second nav array rendered nowhere was dead code the dead-nav gate now forbids.
export const LAUNCH_NAV: NavEntry[] = [
  { href: "/sessions", label: "Sessions", icon: ShieldAlert, match: "/sessions" },
  { href: "/policies", label: "Policies", icon: FileCode, match: "/policies" },
  { href: "/settings", label: "Settings", icon: Settings, match: "/settings" },
];

const PREVIEW_NAV: NavEntry[] = [
  // /overview carries the LiveDecisionPanel — the console's only live /v1 evaluation —
  // on fixture telemetry, and /policies/new is the preview of an off-launch-fence
  // capability; both were registered routes nothing linked to until 2026-09-06
  // (scripts/check-console-routes-reachable.mjs). Fixture previews, not launch screens.
  { href: "/overview", label: "Overview", icon: LayoutGrid, match: "/overview" },
  { href: "/signals", label: "Signals", icon: Activity, match: "/signals" },
  { href: "/app-workflows", label: "App workflows", icon: AppWindow, match: "/app-workflows" },
  { href: "/policies/new", label: "New policy", icon: FileCode },
];

const GRID_NAV: NavEntry[] = [
  { href: "/grid", label: "Grid overview", icon: LayoutGrid },
  { href: "/intelligence", label: "Grid intelligence", icon: Sparkles, match: "/intelligence" },
  { href: "/provisioning", label: "Device recorder", icon: MonitorSmartphone, match: "/provisioning" },
  { href: "/app-resilience", label: "App resilience", icon: HeartPulse, match: "/app-resilience" },
  { href: "/signal-sourcing", label: "Signal sourcing", icon: Radio, match: "/signal-sourcing" },
  { href: "/grid-config", label: "Grid config", icon: FileCode, match: "/grid-config" },
  { href: "/system-health", label: "System health", icon: Activity, match: "/system-health" },
];

function NavSection({ entries, location }: { entries: NavEntry[]; location: string }) {
  return (
    <SidebarMenu className="px-2 gap-1">
      {entries.map((e) => {
        const Icon = e.icon;
        const active = e.match ? location.startsWith(e.match) : location === e.href;
        return (
          <SidebarMenuItem key={e.href}>
            <SidebarMenuButton asChild isActive={active}>
              <Link href={e.href}>
                <Icon className="w-4 h-4 mr-2" />
                <span>{e.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pt-4 pb-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
      {children}
    </div>
  );
}

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
            <SectionLabel>Launch console · /v1</SectionLabel>
            <NavSection entries={LAUNCH_NAV} location={location} />
            <SectionLabel>Fixture previews · not launch</SectionLabel>
            <NavSection entries={PREVIEW_NAV} location={location} />
            <SectionLabel>Build the grid · demo</SectionLabel>
            <NavSection entries={GRID_NAV} location={location} />
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
