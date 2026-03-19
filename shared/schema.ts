import { pgTable, text, serial, integer, boolean, json, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Scan results table
export const scans = pgTable("scans", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  score: integer("score"),
  grade: text("grade"),
  totalViolations: integer("total_violations"),
  criticalCount: integer("critical_count"),
  seriousCount: integer("serious_count"),
  moderateCount: integer("moderate_count"),
  minorCount: integer("minor_count"),
  violations: json("violations").$type<Violation[]>(),
  fixes: json("fixes").$type<Fix[]>(),
  agentLog: json("agent_log").$type<AgentStep[]>(),
  status: text("status").notNull().default("pending"),
});

export interface Violation {
  id: string;
  impact: "critical" | "serious" | "moderate" | "minor";
  description: string;
  element: string;
  wcagCriteria: string;
  suggestedFix: string;
}

export interface Fix {
  violationId: string;
  action: string;
  status: "pending" | "applied" | "failed";
  details: string;
}

export interface AgentStep {
  agent: string;
  action: string;
  timestamp: string;
  details: string;
}

export const insertScanSchema = createInsertSchema(scans).omit({ id: true });
export type InsertScan = z.infer<typeof insertScanSchema>;
export type Scan = typeof scans.$inferSelect;
