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

// Shopify Admin API helper
const SHOPIFY_STORE = "originsnyc.myshopify.com";

async function shopifyGraphQL(query: string, variables: any = {}, shopifyToken: string) {
  const res = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": shopifyToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

// Get the main theme ID
async function getMainThemeId(shopifyToken: string): Promise<string | null> {
  const query = `{ themes(first: 10, roles: [MAIN]) { nodes { id name role } } }`;
  try {
    const data = await shopifyGraphQL(query, {}, shopifyToken);
    return data?.data?.themes?.nodes?.[0]?.id || null;
  } catch {
    return null;
  }
}

// Read a theme file
async function readThemeFile(themeId: string, filename: string, shopifyToken: string): Promise<string | null> {
  const query = `query($id: ID!) { theme(id: $id) { files(filenames: ["${filename}"], first: 1) { nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } } } } }`;
  try {
    const data = await shopifyGraphQL(query, { id: themeId }, shopifyToken);
    return data?.data?.theme?.files?.nodes?.[0]?.body?.content || null;
  } catch {
    return null;
  }
}

// Write a theme file
async function writeThemeFile(themeId: string, filename: string, content: string, shopifyToken: string) {
  const query = `mutation($id: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $id, files: $files) {
      upsertedThemeFiles { filename }
      userErrors { field message }
    }
  }`;
  const variables = {
    id: themeId,
    files: [{ filename, body: { type: "TEXT", value: content } }],
  };
  return shopifyGraphQL(query, variables, shopifyToken);
}

export interface ShopifyFix {
  violationId: string;
  action: string;
  file: string;
  description: string;
  status: "applied" | "failed" | "skipped";
  details: string;
}

// Agent 4: Shopify Fixer — ACTUALLY WRITES code to the Shopify theme
export async function shopifyFixerExecute(
  violations: Violation[],
  crawlData: any,
  apiKey: string,
  shopifyToken: string
): Promise<ShopifyFix[]> {
  const fixes: ShopifyFix[] = [];

  // Step 1: Get the main theme
  const themeId = await getMainThemeId(shopifyToken);
  if (!themeId) {
    return [{
      violationId: "all",
      action: "connect",
      file: "N/A",
      description: "Could not connect to Shopify theme",
      status: "failed",
      details: "Unable to retrieve the main theme. Check the Shopify access token.",
    }];
  }

  // Step 2: Ask Nemotron to generate actual Liquid/CSS fixes
  const fixPrompt = `You are a Shopify Liquid code expert specializing in WCAG 2.1 AA accessibility fixes.
You have access to the main Shopify theme for originsnyc.com.

Violations found:
${JSON.stringify(violations.slice(0, 8), null, 2)}

HTML snippet from the page:
${crawlData.html.substring(0, 4000)}

Generate SPECIFIC code fixes for the Shopify theme. For each fix, specify:
- violationId: which violation this fixes
- file: the Shopify theme file to edit (e.g., "layout/theme.liquid", "snippets/accessibility-fixes.liquid", "assets/accessibility.css")
- action: "inject_snippet" (add new code) or "create_file" (create new file)
- code: the exact Liquid, HTML, or CSS code to add
- insertAfter: for inject_snippet, what tag or string to insert after (e.g., "<head>", "<body>", "</head>")
- description: what this fix does

Focus on these high-impact fixes:
1. Add skip navigation link
2. Add missing ARIA labels
3. Fix color contrast with CSS
4. Add alt text patterns
5. Add focus indicators
6. Add lang attribute if missing

Return ONLY a valid JSON array of fix objects. No markdown.`;

  let nemotronFixes: any[] = [];
  try {
    const response = await callNemotron([{ role: "user", content: fixPrompt }], apiKey);
    const cleaned = response.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
    nemotronFixes = JSON.parse(cleaned);
  } catch {
    // Fallback: generate standard accessibility fixes
    nemotronFixes = [
      {
        violationId: "skip-nav",
        file: "snippets/wcag-accessibility.liquid",
        action: "create_file",
        code: `<!-- WCAG Accessibility Fixes by Origins WCAG Agent -->
<style>
  .wcag-skip-nav { position: absolute; top: -40px; left: 0; background: #000; color: #fff; padding: 8px 16px; z-index: 100000; transition: top 0.3s; font-size: 16px; font-weight: bold; }
  .wcag-skip-nav:focus { top: 0; }
  *:focus { outline: 2px solid #4A90D9 !important; outline-offset: 2px !important; }
  img:not([alt]) { outline: 3px solid red !important; }
  img[alt=""] { outline: 3px solid orange !important; }
  .wcag-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
</style>
<a class="wcag-skip-nav" href="#MainContent">Skip to content</a>
<script>
document.addEventListener('DOMContentLoaded', function() {
  // Add lang attribute if missing
  if (!document.documentElement.lang) { document.documentElement.lang = 'en'; }
  // Add aria-labels to images without alt
  document.querySelectorAll('img:not([alt])').forEach(function(img, i) {
    img.setAttribute('alt', 'Image ' + (i + 1) + ' on ' + document.title);
    img.setAttribute('role', 'img');
  });
  // Add aria-labels to links without text
  document.querySelectorAll('a:not([aria-label])').forEach(function(link) {
    if (!link.textContent.trim() && !link.getAttribute('aria-label')) {
      var img = link.querySelector('img');
      link.setAttribute('aria-label', img ? (img.alt || 'Link') : 'Navigation link');
    }
  });
  // Add aria-labels to buttons without text
  document.querySelectorAll('button:not([aria-label])').forEach(function(btn) {
    if (!btn.textContent.trim()) { btn.setAttribute('aria-label', 'Button'); }
  });
  // Add labels to inputs without them
  document.querySelectorAll('input:not([aria-label]):not([id])').forEach(function(input, i) {
    input.setAttribute('aria-label', input.placeholder || input.type || 'Input field ' + (i + 1));
  });
  // Ensure role=main exists
  if (!document.querySelector('[role=main], main')) {
    var content = document.getElementById('MainContent');
    if (content) content.setAttribute('role', 'main');
  }
});
</script>`,
        description: "Create WCAG accessibility snippet with skip nav, focus indicators, ARIA labels, and alt text fixes",
      },
      {
        violationId: "focus-css",
        file: "assets/wcag-accessibility.css",
        action: "create_file",
        code: `/* WCAG 2.1 AA Accessibility Fixes - Origins WCAG Agent */
:root { --wcag-focus-color: #4A90D9; --wcag-focus-width: 2px; }
*:focus-visible { outline: var(--wcag-focus-width) solid var(--wcag-focus-color) !important; outline-offset: 2px !important; }
a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: var(--wcag-focus-width) solid var(--wcag-focus-color) !important; outline-offset: 2px !important; box-shadow: 0 0 0 4px rgba(74, 144, 217, 0.3) !important; }
.wcag-skip-nav { position: absolute; top: -100%; left: 16px; background: #000; color: #fff; padding: 12px 24px; z-index: 999999; border-radius: 0 0 4px 4px; font-size: 16px; font-weight: 600; text-decoration: none; }
.wcag-skip-nav:focus { top: 0; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }`,
        description: "Add WCAG-compliant focus indicators and reduced-motion support",
      },
    ];
  }

  // Step 3: Apply each fix to the Shopify theme
  for (const fix of nemotronFixes) {
    try {
      if (fix.action === "create_file" || fix.action === "inject_snippet") {
        if (fix.action === "inject_snippet" && fix.insertAfter) {
          // Read existing file, inject code
          const existing = await readThemeFile(themeId, fix.file, shopifyToken);
          if (existing) {
            const updated = existing.replace(fix.insertAfter, fix.insertAfter + "\n" + fix.code);
            const result = await writeThemeFile(themeId, fix.file, updated, shopifyToken);
            const errors = result?.data?.themeFilesUpsert?.userErrors || [];
            fixes.push({
              violationId: fix.violationId,
              action: fix.action,
              file: fix.file,
              description: fix.description,
              status: errors.length === 0 ? "applied" : "failed",
              details: errors.length === 0 ? `Injected fix into ${fix.file}` : errors.map((e: any) => e.message).join(", "),
            });
          } else {
            fixes.push({
              violationId: fix.violationId,
              action: fix.action,
              file: fix.file,
              description: fix.description,
              status: "failed",
              details: `Could not read ${fix.file}`,
            });
          }
        } else {
          // Create new file
          const result = await writeThemeFile(themeId, fix.file, fix.code, shopifyToken);
          const errors = result?.data?.themeFilesUpsert?.userErrors || [];
          fixes.push({
            violationId: fix.violationId,
            action: "create_file",
            file: fix.file,
            description: fix.description,
            status: errors.length === 0 ? "applied" : "failed",
            details: errors.length === 0 ? `Created ${fix.file} in theme` : errors.map((e: any) => e.message).join(", "),
          });
        }
      }
    } catch (err: any) {
      fixes.push({
        violationId: fix.violationId,
        action: fix.action || "unknown",
        file: fix.file || "unknown",
        description: fix.description || "Fix attempt",
        status: "failed",
        details: err.message || "Unknown error",
      });
    }
  }

  // Step 4: Inject the snippet into theme.liquid if we created one
  const snippetFix = nemotronFixes.find((f: any) => f.file?.includes("snippets/"));
  if (snippetFix) {
    try {
      const snippetName = snippetFix.file.replace("snippets/", "").replace(".liquid", "");
      const themeLiquid = await readThemeFile(themeId, "layout/theme.liquid", shopifyToken);
      if (themeLiquid && !themeLiquid.includes(snippetName)) {
        const renderTag = `{% render '${snippetName}' %}`;
        const updated = themeLiquid.replace("<head>", `<head>\n  ${renderTag}`);
        const result = await writeThemeFile(themeId, "layout/theme.liquid", updated, shopifyToken);
        const errors = result?.data?.themeFilesUpsert?.userErrors || [];
        fixes.push({
          violationId: "theme-inject",
          action: "inject_snippet",
          file: "layout/theme.liquid",
          description: `Injected {% render '${snippetName}' %} into theme.liquid <head>`,
          status: errors.length === 0 ? "applied" : "failed",
          details: errors.length === 0 ? "Snippet now loads on every page" : errors.map((e: any) => e.message).join(", "),
        });
      }
    } catch (err: any) {
      fixes.push({
        violationId: "theme-inject",
        action: "inject_snippet",
        file: "layout/theme.liquid",
        description: "Inject accessibility snippet into theme",
        status: "failed",
        details: err.message || "Could not inject snippet",
      });
    }
  }

  // Step 5: Inject CSS file if created
  const cssFix = nemotronFixes.find((f: any) => f.file?.includes("assets/") && f.file?.endsWith(".css"));
  if (cssFix) {
    try {
      const cssFilename = cssFix.file.replace("assets/", "");
      const themeLiquid = await readThemeFile(themeId, "layout/theme.liquid", shopifyToken);
      if (themeLiquid && !themeLiquid.includes(cssFilename)) {
        const cssTag = `{{ '${cssFilename}' | asset_url | stylesheet_tag }}`;
        const updated = themeLiquid.replace("</head>", `  ${cssTag}\n</head>`);
        const result = await writeThemeFile(themeId, "layout/theme.liquid", updated, shopifyToken);
        const errors = result?.data?.themeFilesUpsert?.userErrors || [];
        fixes.push({
          violationId: "css-inject",
          action: "inject_snippet",
          file: "layout/theme.liquid",
          description: `Injected ${cssFilename} stylesheet link into theme.liquid`,
          status: errors.length === 0 ? "applied" : "failed",
          details: errors.length === 0 ? "CSS now loads on every page" : errors.map((e: any) => e.message).join(", "),
        });
      }
    } catch (err: any) {
      fixes.push({
        violationId: "css-inject",
        action: "inject_snippet",
        file: "layout/theme.liquid",
        description: "Inject accessibility CSS into theme",
        status: "failed",
        details: err.message || "Could not inject CSS",
      });
    }
  }

  return fixes;
}
