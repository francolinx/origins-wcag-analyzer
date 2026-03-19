import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Globe,
  Bot,
  Zap,
  Eye,
  ShoppingBag,
  Clock,
} from "lucide-react";
import {
  crawlPage,
  analyzeViolations,
  generateReport,
  shopifyFixerRecommend,
  type Violation,
  type AgentStep,
} from "@/lib/nemotron";

const GRADE_COLORS: Record<string, string> = {
  A: "bg-emerald-500",
  B: "bg-green-500",
  C: "bg-yellow-500",
  D: "bg-orange-500",
  F: "bg-red-500",
};

const IMPACT_COLORS: Record<string, string> = {
  critical: "bg-red-500/10 text-red-400 border-red-500/30",
  serious: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  moderate: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  minor: "bg-blue-500/10 text-blue-400 border-blue-500/30",
};

function AgentTimeline({ steps }: { steps: AgentStep[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps.length]);

  return (
    <div className="space-y-3 max-h-80 overflow-y-auto pr-2">
      {steps.map((step, i) => (
        <div
          key={i}
          className="flex items-start gap-3 animate-in fade-in slide-in-from-left-2 duration-300"
          data-testid={`agent-step-${i}`}
        >
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-sm">
            {step.agent.includes("Crawler") ? "🕷️" : step.agent.includes("Analyzer") ? "🔍" : step.agent.includes("Reporter") ? "📊" : step.agent.includes("Fixer") ? "🔧" : "⚡"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-200">{step.agent}</span>
              <span className="text-xs text-zinc-500">
                {new Date(step.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <p className="text-sm text-zinc-400">{step.action}</p>
            <p className="text-xs text-zinc-500 truncate">{step.details}</p>
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

function ViolationCard({ violation }: { violation: Violation }) {
  return (
    <div
      className={`border rounded-lg p-4 ${IMPACT_COLORS[violation.impact]}`}
      data-testid={`violation-${violation.id}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="font-medium text-sm">{violation.description}</h4>
        <Badge variant="outline" className="shrink-0 text-xs">
          {violation.impact}
        </Badge>
      </div>
      <div className="space-y-1 text-xs opacity-80">
        <p>
          <span className="font-medium">Element:</span>{" "}
          <code className="bg-black/20 px-1 rounded">{violation.element}</code>
        </p>
        <p>
          <span className="font-medium">WCAG:</span> {violation.wcagCriteria}
        </p>
        <p>
          <span className="font-medium">Fix:</span> {violation.suggestedFix}
        </p>
      </div>
    </div>
  );
}

function ScoreDisplay({ score, grade }: { score: number; grade: string }) {
  return (
    <div className="flex items-center gap-6">
      <div className="relative w-32 h-32">
        <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="50" fill="none" stroke="#27272a" strokeWidth="10" />
          <circle
            cx="60"
            cy="60"
            r="50"
            fill="none"
            stroke={score >= 80 ? "#22c55e" : score >= 60 ? "#eab308" : score >= 40 ? "#f97316" : "#ef4444"}
            strokeWidth="10"
            strokeDasharray={`${(score / 100) * 314} 314`}
            strokeLinecap="round"
            className="transition-all duration-1000"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-white">{score}</span>
          <span className="text-xs text-zinc-400">/ 100</span>
        </div>
      </div>
      <div>
        <div className={`w-16 h-16 rounded-xl ${GRADE_COLORS[grade] || "bg-zinc-600"} flex items-center justify-center`}>
          <span className="text-3xl font-bold text-white">{grade}</span>
        </div>
        <p className="text-xs text-zinc-500 mt-1 text-center">Grade</p>
      </div>
    </div>
  );
}

interface ScanResult {
  score: number;
  grade: string;
  violations: Violation[];
  fixes: any[];
  criticalCount: number;
  seriousCount: number;
  moderateCount: number;
  minorCount: number;
}

export default function HomePage() {
  const [url, setUrl] = useState("https://originsnyc.com");
  const [apiKey, setApiKey] = useState("");
  const [enableShopify, setEnableShopify] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [agentLog, setAgentLog] = useState<AgentStep[]>([]);
  const [result, setResult] = useState<ScanResult | null>(null);
  const { toast } = useToast();

  const addLog = useCallback((agent: string, action: string, details: string) => {
    setAgentLog((prev) => [
      ...prev,
      { agent, action, timestamp: new Date().toISOString(), details },
    ]);
  }, []);

  const runScan = useCallback(async () => {
    if (!url || !apiKey) {
      toast({ title: "Missing fields", description: "URL and API key are required", variant: "destructive" });
      return;
    }

    setIsRunning(true);
    setProgress(0);
    setAgentLog([]);
    setResult(null);

    try {
      // Agent 1: Crawler
      setStatusText("Crawling...");
      setProgress(10);
      addLog("🕷️ Crawler Agent", "Fetching page content", `Navigating to ${url}`);

      const crawlData = await crawlPage(url);
      setProgress(25);
      addLog(
        "🕷️ Crawler Agent",
        "Page analyzed",
        `Found: ${crawlData.elements.images?.total || 0} images, ${crawlData.elements.links || 0} links, ${crawlData.elements.headings || 0} headings, ${crawlData.elements.ariaAttributes || 0} ARIA attrs`
      );

      // Agent 2: Analyzer (Nemotron)
      setStatusText("Analyzing with Nemotron...");
      setProgress(35);
      addLog("🔍 Analyzer Agent", "Running Nemotron WCAG analysis", "Using nvidia/nemotron-3-nano-30b-a3b for violation detection");

      const violations = await analyzeViolations(crawlData, apiKey);
      const criticalCount = violations.filter((v) => v.impact === "critical").length;
      const seriousCount = violations.filter((v) => v.impact === "serious").length;
      const moderateCount = violations.filter((v) => v.impact === "moderate").length;
      const minorCount = violations.filter((v) => v.impact === "minor").length;

      setProgress(55);
      addLog(
        "🔍 Analyzer Agent",
        "Violations identified",
        `Found ${violations.length} violations: ${criticalCount} critical, ${seriousCount} serious, ${moderateCount} moderate, ${minorCount} minor`
      );

      // Agent 3: Reporter (Nemotron)
      setStatusText("Generating report...");
      setProgress(70);
      addLog("📊 Reporter Agent", "Generating accessibility report", "Nemotron computing score and summary");

      const report = await generateReport(violations, crawlData, apiKey);
      setProgress(80);
      addLog("📊 Reporter Agent", "Report complete", `Score: ${report.score}/100 (${report.grade}) - ${report.summary}`);

      // Agent 4: Shopify Fixer
      let fixes: any[] = [];
      if (enableShopify) {
        setStatusText("Generating Shopify fixes...");
        setProgress(90);
        addLog("🔧 Shopify Fixer Agent", "Analyzing fixable violations", "Generating Shopify Admin API mutations for originsnyc.com");

        fixes = await shopifyFixerRecommend(violations, apiKey);
        addLog(
          "🔧 Shopify Fixer Agent",
          "Fix recommendations ready",
          `${fixes.length} Shopify API fixes recommended for originsnyc.com`
        );
      }

      setProgress(100);
      setStatusText("Complete");
      setResult({
        score: report.score,
        grade: report.grade,
        violations,
        fixes,
        criticalCount,
        seriousCount,
        moderateCount,
        minorCount,
      });

      addLog("✅ Pipeline", "All 4 agents complete", `Score: ${report.score}/100 | ${violations.length} violations | ${fixes.length} fixes`);

      toast({ title: "Scan complete", description: `Score: ${report.score}/100 (${report.grade})` });
    } catch (err: any) {
      addLog("❌ Error", "Pipeline failed", err.message);
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
    } finally {
      setIsRunning(false);
    }
  }, [url, apiKey, enableShopify, addLog, toast]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                Origins WCAG Analyzer
              </h1>
              <p className="text-xs text-zinc-500">
                Powered by NVIDIA Nemotron + Shopify Integration
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-green-400 border-green-500/30 text-xs">
              <Zap className="w-3 h-3 mr-1" />
              4-Agent System
            </Badge>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Hero */}
        <div className="mb-8 text-center">
          <h2 className="text-xl font-semibold mb-2">
            WCAG 2.1 AA Accessibility Analyzer
          </h2>
          <p className="text-sm text-zinc-400 max-w-xl mx-auto">
            Multi-agent AI system that crawls your site, analyzes WCAG compliance
            using NVIDIA Nemotron, generates a report, and recommends Shopify API
            fixes for originsnyc.com.
          </p>
        </div>

        {/* Agent Architecture */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {[
            { icon: Globe, name: "Crawler", desc: "Fetches & parses HTML DOM", color: "text-blue-400" },
            { icon: Eye, name: "Analyzer", desc: "Nemotron WCAG analysis", color: "text-purple-400" },
            { icon: Bot, name: "Reporter", desc: "Score & grade generation", color: "text-amber-400" },
            { icon: ShoppingBag, name: "Shopify Fixer", desc: "Auto-fix via Shopify API", color: "text-green-400" },
          ].map((agent, i) => (
            <Card key={i} className="bg-zinc-900 border-zinc-800">
              <CardContent className="p-4 text-center">
                <agent.icon className={`w-6 h-6 mx-auto mb-2 ${agent.color}`} />
                <p className="text-sm font-medium">{agent.name}</p>
                <p className="text-xs text-zinc-500">{agent.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Scan Form */}
        <Card className="bg-zinc-900 border-zinc-800 mb-8">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Website URL</label>
                <Input
                  data-testid="input-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://originsnyc.com"
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">NVIDIA API Key</label>
                <Input
                  data-testid="input-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="nvapi-..."
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch
                  data-testid="switch-shopify"
                  checked={enableShopify}
                  onCheckedChange={setEnableShopify}
                />
                <label className="text-sm text-zinc-400">
                  Enable Shopify Auto-Fix (originsnyc.com)
                </label>
              </div>
              <Button
                data-testid="button-scan"
                onClick={runScan}
                disabled={!url || !apiKey || isRunning}
                className="bg-green-600 hover:bg-green-700"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <Shield className="w-4 h-4 mr-2" />
                    Run WCAG Scan
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Progress Bar */}
        {isRunning && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-zinc-400 capitalize flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                {statusText}
              </span>
              <span className="text-sm text-zinc-500">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-6">
            {/* Score + Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="bg-zinc-900 border-zinc-800 md:col-span-1">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-zinc-400">Score</CardTitle>
                </CardHeader>
                <CardContent className="flex justify-center">
                  <ScoreDisplay score={result.score} grade={result.grade} />
                </CardContent>
              </Card>

              <Card className="bg-zinc-900 border-zinc-800 md:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-zinc-400">Violation Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-3 mb-4">
                    {[
                      { label: "Critical", count: result.criticalCount, color: "text-red-400" },
                      { label: "Serious", count: result.seriousCount, color: "text-orange-400" },
                      { label: "Moderate", count: result.moderateCount, color: "text-yellow-400" },
                      { label: "Minor", count: result.minorCount, color: "text-blue-400" },
                    ].map((s) => (
                      <div key={s.label} className="text-center">
                        <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
                        <p className="text-xs text-zinc-500">{s.label}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-sm text-zinc-300">
                    Total: {result.violations.length} violations found on{" "}
                    <span className="text-green-400">{url}</span>
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Violations List */}
            {result.violations.length > 0 && (
              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-400" />
                    WCAG Violations ({result.violations.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {result.violations.map((v, i) => (
                    <ViolationCard key={i} violation={v} />
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Shopify Fixes */}
            {result.fixes.length > 0 && (
              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-green-400" />
                    Shopify Fix Recommendations ({result.fixes.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {result.fixes.map((fix: any, i: number) => (
                    <div
                      key={i}
                      className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700"
                      data-testid={`fix-${i}`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                        <p className="text-sm font-medium">{fix.action || "Shopify API Fix"}</p>
                      </div>
                      <p className="text-xs text-zinc-400 mb-2">{fix.details}</p>
                      {fix.shopifyCode && (
                        <pre className="text-xs bg-black/30 p-2 rounded overflow-x-auto text-green-300">
                          {fix.shopifyCode}
                        </pre>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Agent Log */}
        {agentLog.length > 0 && (
          <Card className="bg-zinc-900 border-zinc-800 mt-6">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Bot className="w-4 h-4 text-purple-400" />
                Agent Activity Log
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AgentTimeline steps={agentLog} />
            </CardContent>
          </Card>
        )}

        {/* Tech Stack Footer */}
        <div className="mt-12 text-center text-xs text-zinc-600 space-y-2">
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <span>NVIDIA Nemotron (nemotron-3-nano-30b-a3b)</span>
            <span>•</span>
            <span>LangGraph-style 4-Agent Pipeline</span>
            <span>•</span>
            <span>Shopify Admin API</span>
            <span>•</span>
            <span>React + Tailwind</span>
          </div>
          <p>Vibe Hack - NVIDIA GTC 2026 | Team Origins NYC</p>
          <PerplexityAttribution />
        </div>
      </main>
    </div>
  );
}
