import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const signalEventsTable = pgTable("signal_events", {
  id: text("id").primaryKey(),
  signalType: text("signal_type").notNull(), // identity | device-posture | session-context | operational-signals
  platform: text("platform").notNull(),
  deviceId: text("device_id").notNull(),
  value: jsonb("value").notNull().default({}),
  status: text("status").notNull().default("nominal"), // nominal | anomalous | critical | unknown
  receivedAt: timestamp("received_at").notNull().defaultNow(),
});

export const insertSignalEventSchema = createInsertSchema(signalEventsTable);
export const selectSignalEventSchema = createSelectSchema(signalEventsTable);
export type InsertSignalEvent = z.infer<typeof insertSignalEventSchema>;
export type SignalEvent = typeof signalEventsTable.$inferSelect;
