// Client-side Nemotron API caller
const NVIDIA_API_BASE = "https://integrate.api.nvidia.com/v1";
const NEMOTRON_MODEL = "nvidia/nemotron-3-nano-30b-a3b";

export async function callNemotron(messages: any[], apiKey: string): Promise<string> {
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

// Crawler: fetch via a CORS proxy or direct
export async function crawlPage(url: string) {
  // Use allorigins as a CORS proxy for client-side fetching
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  
  let html = "";
  try {
    const res = await fetch(proxyUrl);
    html = await res.text();
  } catch {
    // Fallback: try direct fetch
    try {
      const res = await fetch(url, { mode: "no-cors" });
      html = await res.text();
    } catch {
      html = "";
    }
  }

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
  const buttonCount = (html.match(/<button/gi) || []).length;
  const hasSkipNav = /skip.*nav|skip.*content/i.test(html);
  const tabindex = (html.match(/tabindex/gi) || []).length;

  return {
    html: html.substring(0, 15000),
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
}

export interface Violation {
  id: string;
  impact: "critical" | "serious" | "moderate" | "minor";
  description: string;
  element: string;
  wcagCriteria: string;
  suggestedFix: string;
}

export interface AgentStep {
  agent: string;
  action: string;
  timestamp: string;
  details: string;
}

// Agent 2: Analyzer
export async function analyzeViolations(crawlData: any, apiKey: string): Promise<Violation[]> {
  const prompt = `You are a WCAG 2.1 AA accessibility expert. Analyze the following web page data and identify accessibility violations.

Page Title: ${crawlData.title}
Page Elements Summary:
${JSON.stringify(crawlData.elements, null, 2)}

HTML Snippet (first 6000 chars):
${crawlData.html.substring(0, 6000)}

For each violation found, return a JSON array of objects with these fields:
- id: unique identifier (e.g., "img-alt-1")
- impact: "critical", "serious", "moderate", or "minor"
- description: what the issue is
- element: the HTML element or area affected
- wcagCriteria: the specific WCAG 2.1 criterion (e.g., "1.1.1 Non-text Content")
- suggestedFix: how to fix it

Return ONLY a valid JSON array. No markdown, no explanation.`;

  try {
    const response = await callNemotron([{ role: "user", content: prompt }], apiKey);
    const cleaned = response.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    // Fallback violations from crawl data
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
    if (crawlData.elements.inputs > crawlData.elements.labels) {
      violations.push({
        id: "form-labels",
        impact: "serious",
        description: `${crawlData.elements.inputs - crawlData.elements.labels} form inputs may be missing labels`,
        element: "<input>",
        wcagCriteria: "1.3.1 Info and Relationships",
        suggestedFix: "Associate a <label> with every form input",
      });
    }
    if (crawlData.elements.ariaAttributes < 5) {
      violations.push({
        id: "aria-low",
        impact: "moderate",
        description: "Low use of ARIA attributes for accessibility",
        element: "Various",
        wcagCriteria: "4.1.2 Name, Role, Value",
        suggestedFix: "Add appropriate ARIA roles and labels to interactive elements",
      });
    }
    return violations;
  }
}

// Agent 3: Reporter
export async function generateReport(violations: Violation[], crawlData: any, apiKey: string) {
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

  try {
    const response = await callNemotron([{ role: "user", content: prompt }], apiKey);
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

// Agent 4: Shopify Fixer (recommendations only in client mode)
export async function shopifyFixerRecommend(violations: Violation[], apiKey: string) {
  const prompt = `You are a Shopify accessibility fixer. Given these WCAG violations on a Shopify store (originsnyc.com), recommend specific Shopify Admin API fixes.

Available Shopify API actions:
1. update-product: Update product title, description (HTML), SEO title, SEO description, images, tags
2. update-page: Update page title and HTML body
3. search-products: List products
4. get-pages: List pages

Violations:
${JSON.stringify(violations.slice(0, 8), null, 2)}

For each fixable violation, return a JSON array with:
- violationId: the violation id
- action: which Shopify API to use
- details: specific change to make
- shopifyCode: example GraphQL mutation or API call

Return ONLY valid JSON array.`;

  try {
    const response = await callNemotron([{ role: "user", content: prompt }], apiKey);
    const cleaned = response.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return violations.slice(0, 3).map((v) => ({
      violationId: v.id,
      action: "update-product",
      details: v.suggestedFix,
      shopifyCode: `mutation { productUpdate(input: { id: "gid://shopify/Product/ID", ${v.id.includes("alt") ? 'images: [{ altText: "descriptive text" }]' : 'seoDescription: "accessible description"'} }) { product { id } } }`,
    }));
  }
}
