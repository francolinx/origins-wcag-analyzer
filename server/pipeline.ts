import { URL } from "url";
import type { AgentStep, CreateScanRequest, Scan, ScanFinding, ScanPage } from "@shared/schema";
import { retrieveWcagEvidence } from "./wcag-corpus";

export type PipelineHooks = {
  onStep: (step: AgentStep) => Promise<void>;
};

type PipelineState = {
  scan: Scan;
  pages: ScanPage[];
  findings: ScanFinding[];
  summary: any;
};

export async function runAccessibilityPipeline(scan: Scan, hooks: PipelineHooks): Promise<Partial<Scan>> {
  const state = await runWithLangGraph(scan, hooks);

  return {
    status: state.pages.some((p) => p.crawlError) ? "partial" : "complete",
    pages: state.pages,
    findings: state.findings,
    summary: state.summary,
    updatedAt: new Date().toISOString(),
  };
}

async function runWithLangGraph(scan: Scan, hooks: PipelineHooks): Promise<PipelineState> {
  const initialState: PipelineState = { scan, pages: [], findings: [], summary: null };

  try {
    const moduleName = "@langchain/langgraph";
    const langgraph = (await import(moduleName)) as any;
    const StateGraph = langgraph.StateGraph;
    const START = langgraph.START;
    const END = langgraph.END;

    const graph = new StateGraph({
      channels: {
        scan: { value: (_x: Scan, y: Scan) => y, default: () => scan },
        pages: { value: (_x: ScanPage[], y: ScanPage[]) => y, default: () => [] },
        findings: { value: (_x: ScanFinding[], y: ScanFinding[]) => y, default: () => [] },
        summary: { value: (_x: any, y: any) => y, default: () => null },
      },
    });

    graph
      .addNode("crawlPlanner", async (state: PipelineState) => ({
        pages: await crawlPlannerAndBrowser(state.scan.url, state.scan.settings.maxDepth, state.scan.settings.pageLimit, hooks),
      }))
      .addNode("accessibilityScan", async (state: PipelineState) => ({
        findings: await accessibilityScan(state.pages, hooks, state.scan.settings.enableCrossCheck),
      }))
      .addNode("wcagRemediation", async (state: PipelineState) => ({
        findings: await wcagAndRemediation(state.findings, hooks),
      }))
      .addNode("synthesis", async (state: PipelineState) => ({
        summary: await synthesizeReport(state.findings, hooks),
      }))
      .addEdge(START, "crawlPlanner")
      .addEdge("crawlPlanner", "accessibilityScan")
      .addEdge("accessibilityScan", "wcagRemediation")
      .addEdge("wcagRemediation", "synthesis")
      .addEdge("synthesis", END);

    await log(hooks, "Orchestrator", "LangGraph orchestration active", "Using @langchain/langgraph runtime", "complete");
    const compiled = graph.compile();
    const result = await compiled.invoke(initialState);
    return {
      scan,
      pages: result.pages ?? [],
      findings: result.findings ?? [],
      summary: result.summary ?? null,
    };
  } catch {
    await log(hooks, "Orchestrator", "LangGraph unavailable", "Falling back to deterministic sequential pipeline", "error");

    const pages = await crawlPlannerAndBrowser(scan.url, scan.settings.maxDepth, scan.settings.pageLimit, hooks);
    const findings = await accessibilityScan(pages, hooks, scan.settings.enableCrossCheck);
    const enriched = await wcagAndRemediation(findings, hooks);
    const summary = await synthesizeReport(enriched, hooks);
    return { scan, pages, findings: enriched, summary };
  }
}

async function log(hooks: PipelineHooks, agent: string, action: string, details: string, status: AgentStep["status"]) {
  await hooks.onStep({ agent, action, details, status, timestamp: new Date().toISOString() });
}

async function crawlPlannerAndBrowser(url: string, maxDepth: number, pageLimit: number, hooks: PipelineHooks): Promise<ScanPage[]> {
  await log(hooks, "Crawl Planner Agent", "Planning crawl", `Seed URL ${url}; depth=${maxDepth}, pageLimit=${pageLimit}`, "running");
  const queue: Array<{ url: string; depth: number }> = [{ url, depth: 0 }];
  const visited = new Set<string>();
  const pages: ScanPage[] = [];
  const host = new URL(url).host;

  while (queue.length > 0 && pages.length < pageLimit) {
    const current = queue.shift()!;
    if (visited.has(current.url) || current.depth > maxDepth) continue;
    visited.add(current.url);

    try {
      await log(hooks, "Browser Crawl Agent", "Fetching page", current.url, "running");
      const res = await fetch(current.url, { headers: { "User-Agent": "Mozilla/5.0 Accessibility-Remediation-Copilot" } });
      const html = await res.text();
      const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? current.url;
      const anchors: string[] = [];
      const hrefRegex = /href=["']([^"'#]+)["']/gi;
      let hrefMatch: RegExpExecArray | null;
      while ((hrefMatch = hrefRegex.exec(html)) !== null) anchors.push(hrefMatch[1]);
      const internal = anchors
        .map((href) => {
          try {
            return new URL(href, current.url).toString();
          } catch {
            return null;
          }
        })
        .filter((x): x is string => Boolean(x) && new URL(x!).host === host);

      const prioritized = internal.sort((a, b) => priorityScore(b) - priorityScore(a));
      for (const next of prioritized.slice(0, 8)) {
        if (!visited.has(next)) queue.push({ url: next, depth: current.depth + 1 });
      }

      pages.push({ url: current.url, depth: current.depth, title, screenshotPath: null, crawlError: null });
      await log(hooks, "Browser Crawl Agent", "Page crawled", `${title} (${current.url})`, "complete");
    } catch (error: any) {
      pages.push({ url: current.url, depth: current.depth, title: current.url, screenshotPath: null, crawlError: error.message });
      await log(hooks, "Browser Crawl Agent", "Crawl error", `${current.url}: ${error.message}`, "error");
    }
  }

  await log(hooks, "Crawl Planner Agent", "Plan complete", `Planned/crawled ${pages.length} pages`, "complete");
  return pages;
}

function priorityScore(url: string): number {
  const patterns = [/product/i, /shop/i, /cart/i, /checkout/i, /contact/i, /form/i];
  return patterns.reduce((score, pattern) => score + (pattern.test(url) ? 1 : 0), 0);
}

async function accessibilityScan(pages: ScanPage[], hooks: PipelineHooks, enableCrossCheck: boolean): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];
  for (const page of pages) {
    if (page.crawlError) continue;
    await log(hooks, "Accessibility Scan Agent", "Scanning page", page.url, "running");

    let html = "";
    try {
      html = await (await fetch(page.url)).text();
    } catch {
      continue;
    }

    const missingAlt = (html.match(/<img(?![^>]*alt=)[^>]*>/gi) || []).length;
    if (missingAlt > 0) findings.push(buildFinding(page.url, "image-alt", "critical", `${missingAlt} images appear to miss alt text`, "Images need alt text for screen readers", "img:not([alt])", "<img>"));

    const inputCount = (html.match(/<input/gi) || []).length;
    const labelCount = (html.match(/<label/gi) || []).length;
    if (inputCount > labelCount) findings.push(buildFinding(page.url, "form-label", "serious", "Inputs may be missing visible labels", "Form controls require explicit label relationships", "input", "<input>"));

    if (!/<html[^>]*lang=/i.test(html)) findings.push(buildFinding(page.url, "html-lang", "serious", "Document is missing html lang attribute", "Language metadata supports assistive tools", "html", "<html>"));

    if (!/skip to (main|content)|aria-label=\"skip/i.test(html)) findings.push(buildFinding(page.url, "skip-link", "moderate", "No clear skip navigation mechanism detected", "Keyboard users need bypass links", "a[href*='#main']", "<a>"));

    if (enableCrossCheck && /onclick=/i.test(html) && !/button/i.test(html)) findings.push(buildFinding(page.url, "crosscheck-clickable-div", "minor", "Clickable non-semantic element found in cross-check", "Prefer button or link semantics for clickable UI", "[onclick]", "<div onclick>"));

    await log(hooks, "Accessibility Scan Agent", "Scan complete", `${page.url}: ${findings.filter((f) => f.pageUrl === page.url).length} findings`, "complete");
  }

  await log(hooks, "Cross-check / Audit Agent", "Cross-check pass complete", enableCrossCheck ? "Secondary heuristic checks applied" : "Cross-check disabled", "complete");
  return findings;
}

function buildFinding(pageUrl: string, ruleId: string, impact: ScanFinding["impact"], description: string, help: string, selector: string, htmlSnippet: string): ScanFinding {
  const id = `${ruleId}-${Math.random().toString(16).slice(2, 8)}`;
  return { id, pageUrl, ruleId, impact, description, help, selector, htmlSnippet, confidence: impact === "critical" ? 0.9 : 0.7, screenshotPath: null, annotatedScreenshotPath: null, wcagEvidence: [] };
}

async function wcagAndRemediation(findings: ScanFinding[], hooks: PipelineHooks): Promise<ScanFinding[]> {
  await log(hooks, "WCAG Research Agent", "Retrieving WCAG evidence", `Processing ${findings.length} findings`, "running");
  const enriched = findings.map((finding) => {
    const evidence = retrieveWcagEvidence(`${finding.ruleId} ${finding.description} ${finding.help}`);
    return {
      ...finding,
      wcagEvidence: evidence,
      remediation: {
        explanation: finding.description,
        whyItMatters: finding.help,
        suggestedFix: remediationText(finding.ruleId),
        codeSnippet: remediationSnippet(finding.ruleId),
        implementationNotes: "Validate fix with keyboard-only navigation and screen reader smoke test.",
      },
    };
  });
  await log(hooks, "Remediation Agent", "Generated remediations", `Generated ${enriched.length} copyable fix cards`, "complete");
  return enriched;
}

function remediationText(ruleId: string): string {
  if (ruleId.includes("alt")) return "Add concise alt text to informative images and empty alt for decorative images.";
  if (ruleId.includes("label")) return "Associate each input with a visible label and matching for/id attributes.";
  if (ruleId.includes("lang")) return "Add a valid language tag to the root html element.";
  if (ruleId.includes("skip")) return "Add a skip link as the first focusable element and target a main landmark.";
  return "Use semantic markup and ARIA only when native semantics are not possible.";
}

function remediationSnippet(ruleId: string): string {
  if (ruleId.includes("alt")) return `<img src=\"product.jpg\" alt=\"Black leather tote bag\" />`;
  if (ruleId.includes("label")) return `<label for=\"email\">Email</label><input id=\"email\" name=\"email\" />`;
  if (ruleId.includes("lang")) return `<html lang=\"en\">`;
  if (ruleId.includes("skip")) return `<a class=\"skip-link\" href=\"#main\">Skip to main content</a>`;
  return `<button type=\"button\">Open cart</button>`;
}

async function synthesizeReport(findings: ScanFinding[], hooks: PipelineHooks) {
  await log(hooks, "Synthesis / Reporting Agent", "Building final report", "Prioritizing findings by severity and confidence", "running");
  const critical = findings.filter((f) => f.impact === "critical").length;
  const serious = findings.filter((f) => f.impact === "serious").length;
  const score = Math.max(0, 100 - critical * 18 - serious * 10 - findings.length * 2);
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
  const topIssues = findings.slice(0, 5).map((f) => `${f.impact.toUpperCase()}: ${f.description}`);

  await log(hooks, "Synthesis / Reporting Agent", "Report complete", `Score ${score}, grade ${grade}`, "complete");
  await log(hooks, "Memory / History Agent", "Ready for comparison", "Scan will be compared with previous domain scan", "complete");

  return {
    executiveSummary: `The scan found ${findings.length} accessibility findings across key pages. Highest risk issues are concentrated in non-text alternatives and form semantics.`,
    businessValueSummary: "Remediating top findings reduces legal exposure, improves conversion for keyboard/screen-reader users, and improves SEO crawl clarity.",
    score,
    grade,
    topIssues,
    developerChecklist: [
      "Fix all critical image alternative text issues.",
      "Ensure every form control has a visible programmatic label.",
      "Add or verify page language metadata.",
      "Implement skip links and landmarks for keyboard navigation.",
      "Re-run scan and compare against previous baseline.",
    ],
  };
}

export function compareFindings(current: ScanFinding[], previous: ScanFinding[]) {
  const prevSet = new Set(previous.map((f) => `${f.pageUrl}|${f.ruleId}|${f.selector}`));
  const currentSet = new Set(current.map((f) => `${f.pageUrl}|${f.ruleId}|${f.selector}`));

  let repeated = 0;
  for (const key of Array.from(currentSet)) if (prevSet.has(key)) repeated += 1;

  let resolved = 0;
  for (const key of Array.from(prevSet)) if (!currentSet.has(key)) resolved += 1;

  return { repeatedIssueCount: repeated, resolvedIssueCount: resolved, newIssueCount: currentSet.size - repeated };
}

export function buildInitialScan(payload: CreateScanRequest): Omit<Scan, "id"> {
  const now = new Date().toISOString();
  const domain = new URL(payload.url).host;
  return {
    url: payload.url,
    domain,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    settings: { maxDepth: payload.maxDepth, pageLimit: payload.pageLimit, enableCrossCheck: payload.enableCrossCheck },
    pages: [],
    findings: [],
    agentLog: [],
    summary: null,
    comparison: null,
    errors: [],
  };
}
