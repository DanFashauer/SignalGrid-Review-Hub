import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { controlPlane, type SelfAuditPlainLine } from "@/lib/control-plane";

// System Health — the "just works" administrative surface.
//
// One screen an owner opens with zero product knowledge: a single calm headline,
// each part of the system described in ordinary words, and any fix on offer shown
// as a choice they approve — never something already done. Every word here comes
// from the self-audit's plain-language layer (@workspace/self-audit); this page only
// arranges it. No status codes, no jargon, no manual required.

function lineTone(line: SelfAuditPlainLine): { dot: string; text: string } {
  // "Not checked" is an UNKNOWN state and must never paint green — tested BEFORE the
  // all-clear branch, because a not-yet-checked area can carry needsAttention=false
  // and would otherwise render as verified-healthy.
  if (line.state === "Not checked") return { dot: "bg-slate-400", text: "text-slate-300" };
  if (!line.needsAttention) return { dot: "bg-emerald-400", text: "text-emerald-300" };
  if (line.state === "Needs a look") return { dot: "bg-amber-400", text: "text-amber-300" };
  return { dot: "bg-red-400", text: "text-red-300" };
}

export function SystemHealth() {
  const audit = useQuery({ queryKey: ["cp-self-audit"], queryFn: () => controlPlane.selfAudit() });

  const plain = audit.data?.plain;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">System health</h1>
        <p className="mt-1 text-sm text-slate-400">
          A plain-language read on whether the whole system is working — and anything that needs you.
        </p>
        {audit.data && (
          <p className="mt-2 text-xs text-slate-500">
            {audit.data.source === "real-run"
              ? `Last real check${audit.data.generatedAtRef ? ` at ${audit.data.generatedAtRef}` : ""}${audit.data.heavyChecksRan === false ? " (screens not re-checked)" : ""}.`
              : "Demo snapshot — run the health check to see live results."}
          </p>
        )}
      </div>

      {audit.isLoading && <p className="text-slate-400">Checking…</p>}
      {audit.isError && (
        <Card>
          <CardContent className="p-6 text-red-300">
            Couldn’t reach the system right now. That itself is worth a look — try again in a moment.
          </CardContent>
        </Card>
      )}

      {plain && (
        <>
          {/* The one thing to read first. */}
          <Card>
            <CardContent className="flex items-center gap-4 p-6">
              <span
                className={`inline-block h-4 w-4 shrink-0 rounded-full ${
                  plain.allClear ? "bg-emerald-400" : plain.attentionCount > 0 ? "bg-amber-400" : "bg-slate-400"
                }`}
                aria-hidden
              />
              <div>
                <p className="text-xl font-semibold text-slate-100">{plain.headline}</p>
                {!plain.allClear && (
                  <p className="mt-1 text-sm text-slate-400">
                    The items below marked for attention are what to look at, most important first.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Each part of the system, in ordinary words. */}
          <Card>
            <CardHeader>
              <CardTitle>The parts of the system</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-6 pt-0">
              {plain.lines.map((line) => {
                const tone = lineTone(line);
                return (
                  <div key={line.area} className="flex items-start gap-3">
                    <span className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
                    <div>
                      <p className="text-sm font-medium text-slate-100">
                        {line.area} — <span className={tone.text}>{line.state}</span>
                      </p>
                      <p className="text-sm text-slate-400">{line.sentence}</p>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Fixes on offer — always a choice, never already done. */}
          {plain.suggestedFixes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Suggested fixes — your approval needed</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-6 pt-0">
                <p className="text-sm text-slate-400">
                  Nothing here has been done. Each is a change we can make once you approve it.
                </p>
                {/* Honest in-UI notice, PolicyCreate's pattern: the buttons are disabled
                    because no route records an approval. The old tooltip claimed the
                    button was "wired to the governed heal lifecycle" — it was wired to
                    nothing, and a disabled control that says it is wired is a lie. */}
                <p className="rounded border border-amber-400/30 bg-amber-400/5 px-3 py-2 font-mono text-[11px] text-amber-400/90">
                  Route not served yet — no API endpoint records an approval, so nothing on this
                  screen can start a fix. The proposals are listed for reading only.
                </p>
                {plain.suggestedFixes.map((fix) => (
                  <div key={fix.proposalId} className="rounded-lg border border-slate-700 p-4">
                    <p className="text-sm font-medium text-slate-100">{fix.area}</p>
                    <p className="mt-1 text-sm text-slate-400">{fix.whatWeWouldDo}</p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        className="rounded-md bg-emerald-500/90 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-emerald-400"
                        disabled
                        title="Route not served — no API endpoint records an approval yet. Nothing is wired from this button."
                      >
                        Approve · route not served
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800"
                        disabled
                        title="Route not served — no API endpoint records a decline yet. Nothing is wired from this button."
                      >
                        Not now
                      </button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {audit.data?.note && <p className="px-1 text-xs text-slate-500">{audit.data.note}</p>}
        </>
      )}
    </div>
  );
}

export default SystemHealth;
