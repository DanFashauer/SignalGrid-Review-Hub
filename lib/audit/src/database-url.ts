// The ONE reading of DATABASE_URL for every durable store: the audit ledger
// (backend.ts), decisions and sessions (@workspace/persistence, which imports it
// from here — persistence depends on audit, never the reverse). Three readers
// that disagreed meant a padded URL persisted a decision while the ledger
// failed: a decision with no audit record.
//
// BUILD_BACKLOG "Empty/whitespace DATABASE_URL", trim half only:
//   · unset or ""            → null: durable persistence is OFF (the supported,
//                              fixture-safe default — unchanged).
//   · surrounding whitespace → trimmed (a secret mounted with a trailing newline
//                              is the same URL, not a different one).
//   · whitespace ONLY        → REFUSED. It was set, so someone meant a database;
//                              reading it as "off" would let a durable deployment
//                              quietly go ephemeral and report ready. Before this
//                              existed pg was handed the blank string and failed
//                              (ENOTFOUND) — closed, but opaquely; this keeps it
//                              closed and names the cause.
// Failing /readyz when a launch profile REQUIRES durability (the row's other
// half) belongs to the launch-profile boundary and is deliberately not here.

export function durableDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.DATABASE_URL;
  if (raw === undefined || raw === "") return null;
  const url = raw.trim();
  if (url === "") {
    throw new Error(
      "DATABASE_URL is set but blank (whitespace only) — refusing to read that as 'no durable store'. " +
        "Unset it to run without persistence, or set it to the runtime connection string.",
    );
  }
  return url;
}
