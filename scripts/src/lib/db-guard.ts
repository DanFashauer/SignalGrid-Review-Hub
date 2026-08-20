// The disposable-cluster declaration every destructive Postgres proof requires.
//
// Every real-Postgres proof in this directory DROPs and recreates the very
// tables it tests, and the role-split proof additionally (re)provisions and
// re-passwords the CLUSTER-WIDE `signalgrid_runtime` role — roles are not
// per-database, so "a throwaway database on a shared server" is not isolation.
// That behavior is correct against a CI service container or a local scratch
// instance and catastrophic against anything persistent.
//
// So pointing DATABASE_URL at a server is NOT consent. The proof runs only
// when SIGNALGRID_DB_DISPOSABLE=1 declares the ENTIRE target cluster — data,
// schema, and roles — throwaway. And the refusal is LOUD (exit 1), not a
// skip: a proof that silently skipped in CI because the flag was forgotten
// would leave the gate green while testing nothing, which is the one outcome
// worse than red.
export function requireDisposableCluster(proofName: string): void {
  if (process.env.SIGNALGRID_DB_DISPOSABLE === "1") return;
  console.error(
    `${proofName}: REFUSING to run — DATABASE_URL is set but SIGNALGRID_DB_DISPOSABLE=1 is not.\n` +
      `This proof DROPs the tables it tests (and the role-split proof alters the cluster-wide\n` +
      `'signalgrid_runtime' role, password included). Set SIGNALGRID_DB_DISPOSABLE=1 only when the\n` +
      `entire target cluster is throwaway (CI service container, local scratch instance) — or unset\n` +
      `DATABASE_URL to skip the real-Postgres proofs entirely.`,
  );
  process.exit(1);
}
