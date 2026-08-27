import { Link } from "wouter";
import { Network, Server, Activity, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Settings — configuration, not product.
 *
 * Sources, connectors, integrations, fleet and tenants live here because they
 * configure how SignalGrid learns facts. They are not what SignalGrid is. Giving
 * them primary navigation was what made the product read as an integration
 * catalogue rather than a decision layer. See docs/PURPOSE.md (DR-019).
 */
const GROUPS = [
  {
    title: "Evidence sources",
    blurb: "Where SignalGrid reads facts from. Read-only; source systems stay authoritative.",
    items: [
      { href: "/connectors/setup", label: "Sources & connectors", icon: Network },
      { href: "/integrations", label: "Integrations", icon: Network },
    ],
  },
  {
    title: "Estate",
    blurb: "Tenants and the device population sessions are drawn from.",
    items: [{ href: "/fleet", label: "Fleet & tenants", icon: Server }],
  },
  {
    title: "Assurance",
    blurb: "What this instance can currently prove about itself.",
    items: [
      { href: "/status", label: "Assurance", icon: Activity },
      { href: "/audit", label: "Audit", icon: ShieldAlert },
    ],
  },
];

export function Settings() {
  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm max-w-2xl">
          Configuration. SignalGrid consumes evidence from these systems and decides;
          they remain authoritative for their own data and their own actions.
        </p>
      </div>

      {GROUPS.map((g) => (
        <div key={g.title} className="space-y-3">
          <div>
            <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
              {g.title}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">{g.blurb}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {g.items.map((i) => {
              const Icon = i.icon;
              return (
                <Link key={i.href} href={i.href}>
                  <Card className="border-border hover:border-primary/50 transition-colors cursor-pointer">
                    <CardContent className="p-4 flex items-center gap-3">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{i.label}</span>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
