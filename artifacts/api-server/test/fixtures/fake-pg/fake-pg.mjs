// A fake `pg` driver that answers EXACTLY the statements PostgresAuditBackend
// (lib/audit/src/backend.ts) issues, over an in-process `audit_ledger` table
// seeded from the NDJSON file named by SIGNALGRID_FAKE_PG_SEED (rows in the
// DB's own column shape, minted by the real appendAuditRecord so every hash is
// genuine). FAIL-CLOSED: a statement it does not recognise THROWS, so a code
// path this fake was never taught can never pass silently as an empty result.
import { readFileSync } from "node:fs";

const seedPath = process.env.SIGNALGRID_FAKE_PG_SEED;
if (!seedPath) throw new Error("fake-pg: SIGNALGRID_FAKE_PG_SEED is unset");
const table = readFileSync(seedPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));

const norm = (sql) => sql.replace(/\s+/g, " ").trim();
const result = (rows) => ({ rows, rowCount: rows.length });

function query(sqlIn, params = []) {
  const sql = norm(sqlIn);
  if (sql.startsWith("CREATE TABLE IF NOT EXISTS public.audit_ledger")) return result([]);
  if (sql === "SELECT 1") return result([{ "?column?": 1 }]);
  if (sql.includes("FROM information_schema.columns") && sql.includes("column_name = 'tenant_id'")) return result([{ "?column?": 1 }]);
  if (sql.startsWith("SELECT has_table_privilege('public.audit_ledger', 'SELECT')")) return result([{ ok: true, forbidden: false }]);
  if (sql === "SELECT id, ts, request_id, actor, event_type, target, meta, tenant_id, prev_hash, hash FROM public.audit_ledger ORDER BY seq ASC OFFSET $1 LIMIT $2") {
    const [offset, limit] = params.map(Number);
    return result(table.slice(offset, offset + limit));
  }
  if (sql === "SELECT id, ts, request_id, actor, event_type, target, meta, tenant_id, prev_hash, hash FROM public.audit_ledger WHERE tenant_id = $1 ORDER BY seq ASC OFFSET $2 LIMIT $3") {
    const [tenantId, offset, limit] = params;
    return result(table.filter((r) => r.tenant_id === tenantId).slice(Number(offset), Number(offset) + Number(limit)));
  }
  if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK" || sql === "SELECT pg_advisory_xact_lock($1)") return result([]);
  if (sql === "SELECT hash FROM public.audit_ledger ORDER BY seq DESC LIMIT 1") return result(table.length ? [{ hash: table[table.length - 1].hash }] : []);
  if (sql.startsWith("INSERT INTO public.audit_ledger")) {
    const [id, ts, request_id, actor, event_type, target, meta, tenant_id, prev_hash, hash] = params;
    const parse = (v) => (v === null ? null : JSON.parse(v));
    table.push({ id, ts, request_id, actor: parse(actor), event_type, target: parse(target), meta: parse(meta), tenant_id, prev_hash, hash });
    return result([]);
  }
  throw new Error(`fake-pg: unrecognised statement: ${sql.slice(0, 120)}`);
}

export class Pool {
  constructor() {}
  async query(sql, params) { return query(sql, params); }
  async connect() { return { query: async (sql, params) => query(sql, params), release() {} }; }
  async end() {}
}

export default { Pool };
