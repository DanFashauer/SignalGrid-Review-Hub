import { pgTable, text, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const policiesTable = pgTable("policies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  workflowPattern: text("workflow_pattern").notNull(),
  rules: jsonb("rules").notNull().default([]),
  failMode: text("fail_mode").notNull().default("fail-open"), // fail-open | fail-closed
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPolicySchema = createInsertSchema(policiesTable);
export const selectPolicySchema = createSelectSchema(policiesTable);
export type InsertPolicy = z.infer<typeof insertPolicySchema>;
export type Policy = typeof policiesTable.$inferSelect;
