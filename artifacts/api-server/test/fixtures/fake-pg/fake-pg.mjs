// A fake `pg` driver that answers EXACTLY the statements PostgresAuditBackend
// (lib/audit/src/backend.ts) issues, over an in-process `audit_ledger` table
// seeded from the NDJSON file named by SIGNALGRID_FAKE_PG_SEED (rows in the
// DB's own column shape, minted by the real appendAuditRecord so every hash is
// genuine). FAIL-CLOSED: a statement it does not recognise THROWS, so a code
// path this fake was never taught can never pass silently as an empty result.
//
// Test knobs for the whole-chain walk's keyset page (`WHERE seq > $1`), all optional:
//   SIGNALGRID_FAKE_PG_PAGE_DELAY_MS   each page answers after this many ms (a walk that takes time)
//   SIGNALGRID_FAKE_PG_READ_LOG        a file that gets one line per page read (how many walks ran)
//   SIGNALGRID_FAKE_PG_FAIL_AFTER_SEQ  a page starting at or past this seq THROWS (a database error mid-walk)
//   SIGNALGRID_FAKE_PG_TENANT_DELAY_MS the tenant-scoped read answers after this many ms (the window
//                                      BEFORE the route reaches the walk)
import { appendFileSync, readFileSync } from "node:fs";

const seedPath = process.env.SIGNALGRID_FAKE_PG_SEED;
if (!seedPath) throw new Error("fake-pg: SIGNALGRID_FAKE_PG_SEED is unset");
// node-postgres returns BIGSERIAL as a string; so does this.
const table = readFileSync(seedPath, "utf8").split("\n").filter(Boolean).map((line, i) => ({ seq: String(i + 1), ...JSON.parse(line) }));
const pageDelayMs = Number(process.env.SIGNALGRID_FAKE_PG_PAGE_DELAY_MS ?? 0);
const readLog = process.env.SIGNALGRID_FAKE_PG_READ_LOG;
const failAfterSeq = process.env.SIGNALGRID_FAKE_PG_FAIL_AFTER_SEQ;
const tenantDelayMs = Number(process.env.SIGNALGRID_FAKE_PG_TENANT_DELAY_MS ?? 0);

const norm = (sql) => sql.replace(/\s+/g, " ").trim();
const result = (rows) => ({ rows, rowCount: rows.length });

async function query(sqlIn, params = []) {
  const sql = norm(sqlIn);
  if (sql === "SELECT seq, id, ts, request_id, actor, event_type, target, meta, tenant_id, prev_hash, hash FROM public.audit_ledger WHERE seq > $1 ORDER BY seq ASC LIMIT $2") {
    const [after, limit] = params.map(Number);
    if (readLog) appendFileSync(readLog, `page after ${after}\n`);
    if (pageDelayMs > 0) await new Promise((r) => setTimeout(r, pageDelayMs));
    if (failAfterSeq !== undefined && after >= Number(failAfterSeq)) throw new Error("fake-pg: planted read failure mid-walk");
    return result(table.filter((r) => Number(r.seq) > after).slice(0, limit));
  }
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
    if (tenantDelayMs > 0) await new Promise((r) => setTimeout(r, tenantDelayMs));
    return result(table.filter((r) => r.tenant_id === tenantId).slice(Number(offset), Number(offset) + Number(limit)));
  }
  if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK" || sql === "SELECT pg_advisory_xact_lock($1)") return result([]);
  if (sql === "SELECT hash FROM public.audit_ledger ORDER BY seq DESC LIMIT 1") return result(table.length ? [{ hash: table[table.length - 1].hash }] : []);
  if (sql.startsWith("INSERT INTO public.audit_ledger")) {
    const [id, ts, request_id, actor, event_type, target, meta, tenant_id, prev_hash, hash] = params;
    const parse = (v) => (v === null ? null : JSON.parse(v));
    table.push({ seq: String(table.length + 1), id, ts, request_id, actor: parse(actor), event_type, target: parse(target), meta: parse(meta), tenant_id, prev_hash, hash });
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
