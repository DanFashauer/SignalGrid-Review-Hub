// Apply schema migrations to the durable store. The operator command an
// upgrade runs BEFORE pointing the new revision at the database.
//
//   DATABASE_URL=postgres://... pnpm run db:migrate
//
// Refuses without DATABASE_URL (there is nothing to migrate, and "migrated the
// void" reading as success is the unearned affirmative). Exits 1 when the
// database records a version newer than this code knows — a future database is
// refused, not driven. Idempotent: a second run applies nothing and says so.

import { runMigrations, MIGRATIONS } from "@workspace/persistence";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — there is no durable store to migrate. Refusing.");
    process.exit(2);
  }
  const result = await runMigrations(process.env.DATABASE_URL);
  console.log(`Schema migrations (${MIGRATIONS.length} known, latest version ${result.current})`);
  if (result.applied.length === 0) {
    console.log("  nothing to apply — the database is already current.");
  } else {
    for (const v of result.applied) {
      const m = MIGRATIONS.find((x) => x.version === v);
      console.log(`  applied v${v} — ${m?.name ?? "?"}`);
    }
  }
  console.log(`  schema_version now records ${result.current}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
