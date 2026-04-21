import { z } from "zod";

export const severitySchema = z.enum(["critical", "serious", "moderate", "minor"]);

export const wcagEvidenceSchema = z.object({
  criterion: z.string(),
  title: z.string(),
  sourceUrl: z.string().url(),
  snippet: z.string(),
  techniques: z.array(z.string()).default([]),
});

export const remediationSchema = z.object({
  explanation: z.string(),
  whyItMatters: z.string(),
  suggestedFix: z.string(),
  codeSnippet: z.string(),
  implementationNotes: z.string(),
});

export const findingSchema = z.object({
  id: z.string(),
  pageUrl: z.string().url(),
  ruleId: z.string(),
  impact: severitySchema,
  description: z.string(),
  help: z.string(),
  selector: z.string().default("unknown"),
  htmlSnippet: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0.6),
  screenshotPath: z.string().nullable().default(null),
  annotatedScreenshotPath: z.string().nullable().default(null),
  wcagEvidence: z.array(wcagEvidenceSchema).default([]),
  remediation: remediationSchema.optional(),
});

export const scanPageSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  depth: z.number().int().default(0),
  screenshotPath: z.string().nullable().default(null),
  crawlError: z.string().nullable().default(null),
});

export const agentStepSchema = z.object({
  agent: z.string(),
  action: z.string(),
  details: z.string(),
  timestamp: z.string(),
  status: z.enum(["running", "complete", "error"]),
});

export const scanSummarySchema = z.object({
  executiveSummary: z.string(),
  businessValueSummary: z.string(),
  score: z.number().int().min(0).max(100),
  grade: z.string(),
  topIssues: z.array(z.string()),
  developerChecklist: z.array(z.string()),
});

export const scanStatusSchema = z.enum(["queued", "running", "complete", "partial", "error"]);

export const scanSchema = z.object({
  id: z.number().int(),
  url: z.string().url(),
  domain: z.string(),
  status: scanStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  settings: z.object({
    maxDepth: z.number().int(),
    pageLimit: z.number().int(),
    enableCrossCheck: z.boolean(),
  }),
  pages: z.array(scanPageSchema).default([]),
  findings: z.array(findingSchema).default([]),
  agentLog: z.array(agentStepSchema).default([]),
  summary: scanSummarySchema.nullable().default(null),
  comparison: z
    .object({
      previousScanId: z.number().int().nullable(),
      repeatedIssueCount: z.number().int(),
      resolvedIssueCount: z.number().int(),
      newIssueCount: z.number().int(),
    })
    .nullable()
    .default(null),
  errors: z.array(z.string()).default([]),
});

export const createScanRequestSchema = z.object({
  url: z.string().url(),
  maxDepth: z.number().int().min(0).max(3).default(1),
  pageLimit: z.number().int().min(1).max(12).default(5),
  enableCrossCheck: z.boolean().default(true),
});

export type Scan = z.infer<typeof scanSchema>;
export type ScanFinding = z.infer<typeof findingSchema>;
export type ScanPage = z.infer<typeof scanPageSchema>;
export type AgentStep = z.infer<typeof agentStepSchema>;
export type CreateScanRequest = z.infer<typeof createScanRequestSchema>;
