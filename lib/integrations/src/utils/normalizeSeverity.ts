/** DLP and credential-exposure findings score severity on the identical
 *  byte-for-byte ladder; shared so the mapping cannot drift between the two
 *  connectors. Return type is the literal union itself — no generic, no cast. */
export function normalizeSeverity(
  severity: string | undefined,
): "critical" | "high" | "medium" | "low" | "unknown" {
  switch ((severity ?? "").toLowerCase()) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "medium":
    case "moderate":
      return "medium";
    case "low":
      return "low";
    default:
      return "unknown";
  }
}
