import { motion } from "framer-motion";
import { Activity, ShieldAlert, CheckCircle2 } from "lucide-react";

export default function ProblemSection() {
  return (
    <section className="py-24 bg-zinc-950 border-b border-border/50">
      <div className="container mx-auto px-4 md:px-8 max-w-screen-xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div className="space-y-8">
            <div>
              <h2 className="text-3xl font-bold tracking-tight mb-4">The Login-Time Fallacy</h2>
              <p className="text-muted-foreground text-lg leading-relaxed">
                Traditional Zero Trust tools evaluate identity and device compliance when a user logs in. In frontline environments with shared devices, hours can pass between login and critical workflow execution.
              </p>
            </div>
            
            <div className="space-y-6">
              <div className="flex gap-4 p-4 rounded-lg border border-destructive/20 bg-destructive/5">
                <ShieldAlert className="w-6 h-6 text-destructive shrink-0 mt-1" />
                <div>
                  <h4 className="font-semibold text-foreground">The Gap</h4>
                  <p className="text-sm text-muted-foreground mt-1">A medication cart iPad is "compliant" at 8:00 AM shift start. By 2:00 PM, the security agent has crashed, and the device is out of physical bounds, but the session remains active.</p>
                </div>
              </div>
              
              <div className="flex gap-4 p-4 rounded-lg border border-primary/20 bg-primary/5">
                <Activity className="w-6 h-6 text-primary shrink-0 mt-1" />
                <div>
                  <h4 className="font-semibold text-foreground">The SignalGrid Solution</h4>
                  <p className="text-sm text-muted-foreground mt-1">Evaluation occurs exactly when the workflow is requested. We check real-time service health, ITSM incidents, and shift context in milliseconds before granting access.</p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 to-transparent rounded-xl"></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-4">
                <div className="p-6 rounded-xl border border-border/50 bg-card shadow-sm opacity-50 relative overflow-hidden group">
                  <div className="absolute inset-0 bg-red-500/5 transition-opacity group-hover:opacity-100"></div>
                  <div className="text-xs font-mono text-muted-foreground mb-2">08:00 AM</div>
                  <div className="font-medium">Legacy Access</div>
                  <div className="text-sm text-muted-foreground mt-2">Evaluates once. Grants 12-hour session. Blind to runtime state changes.</div>
                </div>
                <div className="p-6 rounded-xl border border-primary/30 bg-card shadow-sm relative overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary"></div>
                  <div className="text-xs font-mono text-primary mb-2">14:03:45 PM</div>
                  <div className="font-medium">SignalGrid Runtime</div>
                  <div className="text-sm text-muted-foreground mt-2">Continuous evaluation at exact moment of transaction request.</div>
                </div>
              </div>
              <div className="space-y-4 pt-8">
                <div className="p-6 rounded-xl border border-border/50 bg-card shadow-sm opacity-50">
                  <div className="text-xs font-mono text-muted-foreground mb-2">STATE</div>
                  <div className="font-medium text-destructive flex items-center"><span className="w-2 h-2 rounded-full bg-destructive mr-2"></span>Agent Failed</div>
                  <div className="text-sm text-muted-foreground mt-2">Device compromised post-login.</div>
                </div>
                <div className="p-6 rounded-xl border border-border/50 bg-card shadow-sm opacity-50">
                  <div className="text-xs font-mono text-muted-foreground mb-2">OUTCOME</div>
                  <div className="font-medium text-primary flex items-center"><CheckCircle2 className="w-4 h-4 mr-2" />Access Blocked</div>
                  <div className="text-sm text-muted-foreground mt-2">Workflow denied despite active token.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
