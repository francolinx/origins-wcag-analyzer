import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import type { Violation, Fix, AgentStep } from "@shared/schema";

// NVIDIA Nemotron API config
const NVIDIA_API_BASE = "https://integrate.api.nvidia.com/v1";
const NEMOTRON_MODEL = "nvidia/nemotron-3-nano-30b-a3b";

async function callNemotron(messages: any[], apiKey: string): Promise<string> {
  const response = await fetch(`${NVIDIA_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: NEMOTRON_MODEL,
      messages,
      temperature: 0.3,
      top_p: 0.95,
      max_tokens: 4096,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Nemotron API error ${response.status}: ${errText}`);
  }

  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content || "";
}

// Shopify tool caller via external-tool CLI
async function callShopifyTool(toolName: string, args: any): Promise<any> {
  const { execSync } = await import("child_process");
  const params = JSON.stringify({
    source_id: "shopify_developer_app__pipedream",
    tool_name: `shopify_developer_app-${toolName}`,
    arguments: args,
  });
  try {
    const result = execSync(`external-tool call '${params}'`, {
      timeout: 30000,
      encoding: "utf-8",
    });
    return JSON.parse(result);
  } catch (e: any) {
    console.error("Shopify tool error:", e.message);
    return { error: e.message };
  }
}

// Agent 1: Crawler - fetches and parses HTML from a URL
async function crawlerAgent(url: string): Promise<{ html: string; title: string; elements: any }> {
  const log: AgentStep = {
    agent: "Crawler",
    action: "Fetching page HTML",
    timestamp: new Date().toISOString(),
    details: `Crawling ${url}`,
  };

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 WCAG-Analyzer/2.0" },
    });
    const html = await res.text();

    // Extract key accessibility elements
    const imgCount = (html.match(/<img /gi) || []).length;
    const imgNoAlt = (html.match(/<img(?![^>]*alt=)[^>]*>/gi) || []).length;
    const links = (html.match(/<a /gi) || []).length;
    const headings = (html.match(/<h[1-6]/gi) || []).length;
    const forms = (html.match(/<form/gi) || []).length;
    const inputs = (html.match(/<input/gi) || []).length;
    const labelsCount = (html.match(/<label/gi) || []).length;
    const ariaCount = (html.match(/aria-/gi) || []).length;
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const hasLang = /<html[^>]*lang=/i.test(html);
    const hasViewport = /viewport/i.test(html);
    const contrastIssues = (html.match(/color:\s*#[a-f0-9]{3,6}/gi) || []).length;
    const buttonCount = (html.match(/<button/gi) || []).length;
    const hasSkipNav = /skip.*nav|skip.*content/i.test(html);
    const tabindex = (html.match(/tabindex/gi) || []).length;

    return {
      html: html.substring(0, 15000), // Truncate for API
      title: titleMatch?.[1] || "Unknown",
      elements: {
        images: { total: imgCount, missingAlt: imgNoAlt },
        links,
        headings,
        forms,
        inputs,
        labels: labelsCount,
        ariaAttributes: ariaCount,
        hasLangAttribute: hasLang,
        hasViewport,
        buttons: buttonCount,
        hasSkipNav,
        tabindexUsage: tabindex,
      },
    };
  } catch (err: any) {
    return {
      html: "",
      title: "Error",
      elements: { error: err.message },
    };
  }
}

// Agent 2: Analyzer - uses Nemotron to find WCAG violations
async function analyzerAgent(
  crawlData: any,
  apiKey: string
): Promise<Violation[]> {
  const prompt = `You are a WCAG 2.1 AA accessibility expert. Analyze the following web page data and identify accessibility violations.

Page Title: ${crawlData.title}
Page Elements Summary:
${JSON.stringify(crawlData.elements, null, 2)}

HTML Snippet (first 8000 chars):
${crawlData.html.substring(0, 8000)}

For each violation found, return a JSON array of objects with these fields:
- id: unique identifier (e.g., "img-alt-1")
- impact: "critical", "serious", "moderate", or "minor"
- description: what the issue is
- element: the HTML element or area affected
- wcagCriteria: the specific WCAG 2.1 criterion (e.g., "1.1.1 Non-text Content")
- suggestedFix: how to fix it

Return ONLY a valid JSON array. No markdown, no explanation.`;

  const response = await callNemotron(
    [{ role: "user", content: prompt }],
    apiKey
  );

  try {
    const cleaned = response.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    // If parsing fails, create a structured response from the crawler data
    const violations: Violation[] = [];
    if (crawlData.elements.images?.missingAlt > 0) {
      violations.push({
        id: "img-alt-missing",
        impact: "critical",
        description: `${crawlData.elements.images.missingAlt} images missing alt text`,
        element: "<img>",
        wcagCriteria: "1.1.1 Non-text Content",
        suggestedFix: "Add descriptive alt attributes to all images",
      });
    }
    if (!crawlData.elements.hasLangAttribute) {
      violations.push({
        id: "html-lang",
        impact: "serious",
        description: "HTML element missing lang attribute",
        element: "<html>",
        wcagCriteria: "3.1.1 Language of Page",
        suggestedFix: 'Add lang="en" to the <html> element',
      });
    }
    if (!crawlData.elements.hasSkipNav) {
      violations.push({
        id: "skip-nav",
        impact: "moderate",
        description: "No skip navigation link found",
        element: "<body>",
        wcagCriteria: "2.4.1 Bypass Blocks",
        suggestedFix: "Add a skip navigation link at the top of the page",
      });
    }
    return violations;
  }
}

// Agent 3: Reporter - uses Nemotron to generate score and summary
async function reporterAgent(
  violations: Violation[],
  crawlData: any,
  apiKey: string
): Promise<{ score: number; grade: string; summary: string }> {
  const prompt = `You are a WCAG 2.1 AA scoring expert. Given these accessibility violations found on "${crawlData.title}", calculate an accessibility score from 0-100 and assign a letter grade.

Violations found: ${violations.length}
Critical: ${violations.filter((v) => v.impact === "critical").length}
Serious: ${violations.filter((v) => v.impact === "serious").length}
Moderate: ${violations.filter((v) => v.impact === "moderate").length}
Minor: ${violations.filter((v) => v.impact === "minor").length}

Violation details:
${JSON.stringify(violations.slice(0, 10), null, 2)}

Return ONLY a JSON object with these fields:
- score: number 0-100
- grade: "A", "B", "C", "D", or "F"
- summary: a 2-3 sentence summary of the findings

Return ONLY valid JSON. No markdown.`;

  const response = await callNemotron(
    [{ role: "user", content: prompt }],
    apiKey
  );

  try {
    const cleaned = response.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    const critical = violations.filter((v) => v.impact === "critical").length;
    const serious = violations.filter((v) => v.impact === "serious").length;
    const score = Math.max(0, 100 - critical * 20 - serious * 10 - violations.length * 3);
    const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
    return {
      score,
      grade,
      summary: `Found ${violations.length} violations (${critical} critical, ${serious} serious). Score: ${score}/100.`,
    };
  }
}

// Agent 4: Shopify Fixer - connects to Shopify to apply fixes
async function shopifyFixerAgent(
  violations: Violation[],
  apiKey: string
): Promise<Fix[]> {
  const fixes: Fix[] = [];

  // Use Nemotron to reason about which fixes to apply
  const prompt = `You are a Shopify accessibility fixer agent. Given these WCAG violations found on a Shopify store, determine which ones can be fixed via the Shopify Admin API.

Available Shopify API actions:
1. update-product: Can update product title, description (HTML), SEO title, SEO description, images, tags
2. update-page: Can update page title and HTML body content
3. get-pages: Can list all pages
4. search-products: Can search/list products

Violations:
${JSON.stringify(violations.slice(0, 8), null, 2)}

For each fixable violation, return a JSON array of objects:
- violationId: the violation id
- action: which Shopify API action to use
- details: what specific change to make
- priority: "high", "medium", "low"

Return ONLY valid JSON array.`;

  const response = await callNemotron(
    [{ role: "user", content: prompt }],
    apiKey
  );

  // Try to get product data from Shopify
  let products: any = null;
  let pages: any = null;
  try {
    products = await callShopifyTool("search-products", { maxResults: 5 });
    pages = await callShopifyTool("get-pages", { maxResults: 5 });
  } catch (e) {
    console.log("Shopify fetch error (expected in demo):", e);
  }

  // Parse Nemotron's fix recommendations
  let fixPlan: any[] = [];
  try {
    const cleaned = response.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
    fixPlan = JSON.parse(cleaned);
  } catch {
    fixPlan = violations.slice(0, 3).map((v) => ({
      violationId: v.id,
      action: "update-product",
      details: v.suggestedFix,
      priority: v.impact === "critical" ? "high" : "medium",
    }));
  }

  // Execute fixes where possible
  for (const plan of fixPlan) {
    const fix: Fix = {
      violationId: plan.violationId,
      action: `Shopify ${plan.action}: ${plan.details}`,
      status: "pending",
      details: "",
    };

    // For SEO-related fixes, try to update products
    if (plan.action === "update-product" && products && !products.error) {
      try {
        const productList = Array.isArray(products) ? products : products?.data || [];
        if (productList.length > 0) {
          const productId = productList[0]?.id || productList[0]?.node?.id;
          if (productId) {
            const updateResult = await callShopifyTool("update-product", {
              productId,
              seoDescription: `Accessible product - ${plan.details}`,
            });
            fix.status = updateResult.error ? "failed" : "applied";
            fix.details = updateResult.error || "SEO description updated for accessibility";
          }
        }
      } catch {
        fix.status = "failed";
        fix.details = "Could not apply Shopify fix";
      }
    } else {
      fix.status = "pending";
      fix.details = `Recommended: ${plan.details}`;
    }

    fixes.push(fix);
  }

  return fixes;
}

export async function registerRoutes(server: Server, app: Express) {
  // Start a new scan
  app.post("/api/scan", async (req, res) => {
    const { url, apiKey, enableShopifyFix } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }
    if (!apiKey) {
      return res.status(400).json({ error: "NVIDIA API key is required" });
    }

    // Create scan record
    const scan = await storage.createScan({
      url,
      status: "crawling",
      agentLog: [],
    });

    // Run pipeline asynchronously
    (async () => {
      const agentLog: AgentStep[] = [];

      try {
        // Agent 1: Crawler
        agentLog.push({
          agent: "🕷️ Crawler",
          action: "Fetching page content",
          timestamp: new Date().toISOString(),
          details: `Navigating to ${url}`,
        });
        await storage.updateScan(scan.id, { status: "crawling", agentLog });

        const crawlData = await crawlerAgent(url);
        agentLog.push({
          agent: "🕷️ Crawler",
          action: "Page analyzed",
          timestamp: new Date().toISOString(),
          details: `Found: ${crawlData.elements.images?.total || 0} images, ${crawlData.elements.links || 0} links, ${crawlData.elements.headings || 0} headings`,
        });
        await storage.updateScan(scan.id, { status: "analyzing", agentLog });

        // Agent 2: Analyzer (Nemotron)
        agentLog.push({
          agent: "🔍 Analyzer",
          action: "Running Nemotron WCAG analysis",
          timestamp: new Date().toISOString(),
          details: `Using ${NEMOTRON_MODEL} to identify violations`,
        });
        await storage.updateScan(scan.id, { agentLog });

        const violations = await analyzerAgent(crawlData, apiKey);
        const criticalCount = violations.filter((v) => v.impact === "critical").length;
        const seriousCount = violations.filter((v) => v.impact === "serious").length;
        const moderateCount = violations.filter((v) => v.impact === "moderate").length;
        const minorCount = violations.filter((v) => v.impact === "minor").length;

        agentLog.push({
          agent: "🔍 Analyzer",
          action: "Violations identified",
          timestamp: new Date().toISOString(),
          details: `Found ${violations.length} violations: ${criticalCount} critical, ${seriousCount} serious, ${moderateCount} moderate, ${minorCount} minor`,
        });
        await storage.updateScan(scan.id, {
          status: "reporting",
          violations,
          totalViolations: violations.length,
          criticalCount,
          seriousCount,
          moderateCount,
          minorCount,
          agentLog,
        });

        // Agent 3: Reporter (Nemotron)
        agentLog.push({
          agent: "📊 Reporter",
          action: "Generating accessibility report",
          timestamp: new Date().toISOString(),
          details: "Nemotron computing score and generating summary",
        });
        await storage.updateScan(scan.id, { agentLog });

        const report = await reporterAgent(violations, crawlData, apiKey);
        agentLog.push({
          agent: "📊 Reporter",
          action: "Report complete",
          timestamp: new Date().toISOString(),
          details: `Score: ${report.score}/100 (${report.grade}) - ${report.summary}`,
        });
        await storage.updateScan(scan.id, {
          score: report.score,
          grade: report.grade,
          agentLog,
        });

        // Agent 4: Shopify Fixer (conditional)
        let fixes: Fix[] = [];
        if (enableShopifyFix) {
          agentLog.push({
            agent: "🔧 Shopify Fixer",
            action: "Connecting to Shopify Admin API",
            timestamp: new Date().toISOString(),
            details: "Analyzing which violations can be auto-fixed via Shopify",
          });
          await storage.updateScan(scan.id, { status: "fixing", agentLog });

          fixes = await shopifyFixerAgent(violations, apiKey);
          const appliedCount = fixes.filter((f) => f.status === "applied").length;
          agentLog.push({
            agent: "🔧 Shopify Fixer",
            action: "Fixes processed",
            timestamp: new Date().toISOString(),
            details: `${appliedCount}/${fixes.length} fixes applied to Shopify store`,
          });
        }

        await storage.updateScan(scan.id, {
          status: "complete",
          fixes,
          agentLog,
        });
      } catch (err: any) {
        agentLog.push({
          agent: "❌ Error",
          action: "Pipeline failed",
          timestamp: new Date().toISOString(),
          details: err.message,
        });
        await storage.updateScan(scan.id, {
          status: "error",
          agentLog,
        });
      }
    })();

    res.json({ scanId: scan.id });
  });

  // Get scan status/results
  app.get("/api/scan/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const scan = await storage.getScan(id);
    if (!scan) {
      return res.status(404).json({ error: "Scan not found" });
    }
    res.json(scan);
  });

  // Get all scans
  app.get("/api/scans", async (_req, res) => {
    const scans = await storage.getAllScans();
    res.json(scans);
  });

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", model: NEMOTRON_MODEL });
  });
}
