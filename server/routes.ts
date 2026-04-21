import type { Express } from "express";
import type { Server } from "http";
import { createScanRequestSchema } from "@shared/schema";
import { storage } from "./storage";
import { buildInitialScan, compareFindings, runAccessibilityPipeline } from "./pipeline";
import { isLangGraphAvailable } from "./langgraph";

export async function registerRoutes(_server: Server, app: Express) {
  app.use("/artifacts", (_req, res, next) => next());

  app.post("/api/scans", async (req, res) => {
    const parsed = createScanRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid scan request", details: parsed.error.flatten() });
    }

    const newScan = await storage.createScan(buildInitialScan(parsed.data));

    (async () => {
      try {
        await storage.updateScan(newScan.id, { status: "running", updatedAt: new Date().toISOString() });
        const pipelineOutput = await runAccessibilityPipeline(newScan, {
          onStep: async (step) => {
            const current = await storage.getScan(newScan.id);
            if (!current) return;
            await storage.updateScan(newScan.id, {
              agentLog: [...current.agentLog, step],
              updatedAt: new Date().toISOString(),
            });
          },
        });

        const previous = await storage.findPreviousScanForDomain(newScan.domain, newScan.id);
        const comparison = previous
          ? {
              previousScanId: previous.id,
              ...compareFindings(pipelineOutput.findings ?? [], previous.findings),
            }
          : null;

        await storage.updateScan(newScan.id, {
          ...pipelineOutput,
          comparison,
          updatedAt: new Date().toISOString(),
        });
      } catch (error: any) {
        const current = await storage.getScan(newScan.id);
        await storage.updateScan(newScan.id, {
          status: current?.findings?.length ? "partial" : "error",
          errors: [...(current?.errors ?? []), error.message],
          updatedAt: new Date().toISOString(),
        });
      }
    })();

    res.json({ scanId: newScan.id });
  });

  app.get("/api/scans/:id", async (req, res) => {
    const scanId = Number(req.params.id);
    const scan = await storage.getScan(scanId);
    if (!scan) return res.status(404).json({ error: "Scan not found" });
    return res.json(scan);
  });

  app.get("/api/scans", async (_req, res) => {
    const scans = await storage.listScans();
    return res.json(scans);
  });

  app.get("/api/scans/:id/compare/:otherId", async (req, res) => {
    const first = await storage.getScan(Number(req.params.id));
    const second = await storage.getScan(Number(req.params.otherId));
    if (!first || !second) {
      return res.status(404).json({ error: "One or both scans not found" });
    }

    return res.json({
      fromScanId: first.id,
      toScanId: second.id,
      ...compareFindings(first.findings, second.findings),
    });
  });

  app.get("/api/health", async (_req, res) => {
    const langgraphLoaded = await isLangGraphAvailable();
    res.json({
      status: "ok",
      storage: "json-file-persistent",
      orchestration: langgraphLoaded ? "langgraph" : "fallback",
      langgraphLoaded,
      requireLanggraph: process.env.REQUIRE_LANGGRAPH === "true",
      notes: langgraphLoaded
        ? "LangGraph runtime is active and available"
        : "LangGraph runtime is unavailable; deterministic fallback pipeline is active",
    });
  });
}
