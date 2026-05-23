import { pgTable, text, integer, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const decisionsTable = pgTable("decisions", {
  id: text("id").primaryKey(),
  identityId: text("identity_id").notNull(),
  deviceId: text("device_id").notNull(),
  workflowId: text("workflow_id").notNull(),
  outcome: text("outcome").notNull(), // allow | step-up | restrict | deny
  policyId: text("policy_id"),
  signals: jsonb("signals").notNull().default([]),
  evaluatedAt: timestamp("evaluated_at").notNull().defaultNow(),
  latencyMs: integer("latency_ms").notNull().default(0),
  industry: text("industry"),
  metadata: jsonb("metadata"),
});

export const insertDecisionSchema = createInsertSchema(decisionsTable);
export const selectDecisionSchema = createSelectSchema(decisionsTable);
export type InsertDecision = z.infer<typeof insertDecisionSchema>;
export type Decision = typeof decisionsTable.$inferSelect;
