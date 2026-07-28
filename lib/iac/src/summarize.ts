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
  if (off === 0) return "The fleet matches the declared configuration.";
  const parts: string[] = [];
  if (report.counts.drifted) parts.push(`${report.counts.drifted} drifted`);
  if (report.counts.missing) parts.push(`${report.counts.missing} missing`);
  if (report.counts.unmanaged) parts.push(`${report.counts.unmanaged} not declared`);
  if (report.counts.unknown) parts.push(`${report.counts.unknown} unverifiable`);
  return `${off} thing(s) differ from the declared configuration: ${parts.join(", ")}.`;
}
