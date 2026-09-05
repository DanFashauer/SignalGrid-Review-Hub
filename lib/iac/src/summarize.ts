// @workspace/iac — plain-language summaries. No enum leaks into the headline;
// an admin reads outcomes, not internal status vocabulary.

import type { DriftReport, Plan } from "./types";

/** One-line summary of what a plan would do. */
export function summarizePlan(plan: Plan): string {
  if (!plan.hasChanges) return "Everything matches the declared configuration — no changes to apply.";
  const parts: string[] = [];
  if (plan.counts.create) parts.push(`${plan.counts.create} to add`);
  if (plan.counts.update) parts.push(`${plan.counts.update} to change`);
  if (plan.counts.delete) parts.push(`${plan.counts.delete} to remove`);
  const body = parts.join(", ");
  const gate = plan.requiresApproval ? " Waiting for approval before anything rolls out." : "";
  return `${body}.${gate}`;
}

/** One-line summary of the drift between Git and the fleet. */
export function summarizeDrift(report: DriftReport): string {
  const off = report.counts.drifted + report.counts.missing + report.counts.unmanaged + report.counts.unknown;
  // Nothing declared is not a match, and it is not "1 thing differs" either: the
  // synthetic unknown finding detectDrift emits for an empty desired state is
  // named for what it is. Defence in depth: an `unknown` overall with no other
  // count never reads as a match, whatever produced it.
  const nothingDeclared = report.findings.some((f) => f.status === "unknown" && f.id === "(declared state)");
  if (nothingDeclared || (report.overall === "unknown" && off === 0)) {
    const undeclared = report.counts.unmanaged;
    return (
      "The fleet cannot be compared: nothing is declared, or the declared state could not be read." +
      (undeclared > 0 ? ` ${undeclared} observed resource(s) are not declared anywhere.` : "")
    );
  }
  if (off === 0) return "The fleet matches the declared configuration.";
  const parts: string[] = [];
  if (report.counts.drifted) parts.push(`${report.counts.drifted} drifted`);
  if (report.counts.missing) parts.push(`${report.counts.missing} missing`);
  if (report.counts.unmanaged) parts.push(`${report.counts.unmanaged} not declared`);
  if (report.counts.unknown) parts.push(`${report.counts.unknown} unverifiable`);
  return `${off} thing(s) differ from the declared configuration: ${parts.join(", ")}.`;
}
