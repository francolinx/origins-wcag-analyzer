import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { createScan, getScan, getScanHistory, compareScans } from "@/lib/nemotron";

const statusProgress: Record<string, number> = {
  queued: 10,
  running: 60,
  complete: 100,
  partial: 90,
  error: 100,
};

export default function HomePage() {
  const [url, setUrl] = useState("https://example.com");
  const [maxDepth, setMaxDepth] = useState(1);
  const [pageLimit, setPageLimit] = useState(5);
  const [enableCrossCheck, setEnableCrossCheck] = useState(true);
  const [scanId, setScanId] = useState<number | null>(null);
  const [scan, setScan] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [compareResult, setCompareResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function refreshHistory() {
    const scans = await getScanHistory();
    setHistory(scans);
  }

  useEffect(() => {
    refreshHistory();
  }, []);

  useEffect(() => {
    if (!scanId) return;
    const handle = setInterval(async () => {
      const current = await getScan(scanId);
      setScan(current);
      if (["complete", "partial", "error"].includes(current.status)) {
        clearInterval(handle);
        await refreshHistory();
      }
    }, 1500);
    return () => clearInterval(handle);
  }, [scanId]);

  const severity = useMemo(() => {
    if (!scan?.findings) return { critical: 0, serious: 0, moderate: 0, minor: 0 };
    return {
      critical: scan.findings.filter((f: any) => f.impact === "critical").length,
      serious: scan.findings.filter((f: any) => f.impact === "serious").length,
      moderate: scan.findings.filter((f: any) => f.impact === "moderate").length,
      minor: scan.findings.filter((f: any) => f.impact === "minor").length,
    };
  }, [scan]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4">
      <div className="max-w-6xl mx-auto space-y-4">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle>Accessibility Remediation Copilot for E-commerce and SMB Websites</CardTitle>
          </CardHeader>
          <CardContent className="grid md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <Label>Target URL</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <div>
              <Label>Max Depth</Label>
              <Input type="number" value={maxDepth} onChange={(e) => setMaxDepth(Number(e.target.value))} min={0} max={3} />
            </div>
            <div>
              <Label>Page Limit</Label>
              <Input type="number" value={pageLimit} onChange={(e) => setPageLimit(Number(e.target.value))} min={1} max={12} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={enableCrossCheck} onCheckedChange={setEnableCrossCheck} />
              <Label>Enable cross-check agent</Label>
            </div>
            <div>
              <Button
                disabled={loading}
                onClick={async () => {
                  setLoading(true);
                  try {
                    const created = await createScan({ url, maxDepth, pageLimit, enableCrossCheck });
                    setScanId(created.scanId);
                    setCompareResult(null);
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                {loading ? "Starting..." : "Start Scan"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {scan && (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle>Live Agent Progress · Scan #{scan.id}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2 items-center">
                <Badge>{scan.status}</Badge>
                <span className="text-xs text-zinc-400">{scan.url}</span>
              </div>
              <Progress value={statusProgress[scan.status] || 0} />
              <div className="grid md:grid-cols-4 gap-2 text-sm">
                <div>Critical: {severity.critical}</div>
                <div>Serious: {severity.serious}</div>
                <div>Moderate: {severity.moderate}</div>
                <div>Minor: {severity.minor}</div>
              </div>
              <div className="max-h-56 overflow-y-auto space-y-2 text-sm">
                {(scan.agentLog || []).map((step: any, idx: number) => (
                  <div key={idx} className="border border-zinc-800 rounded p-2">
                    <div className="flex justify-between">
                      <span className="font-medium">{step.agent}</span>
                      <span className="text-xs text-zinc-500">{new Date(step.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-zinc-300">{step.action}</div>
                    <div className="text-zinc-500 text-xs">{step.details}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {scan?.summary && (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader><CardTitle>Executive Summary</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{scan.summary.executiveSummary}</p>
              <p className="text-zinc-400">Business value: {scan.summary.businessValueSummary}</p>
              <p>Score: <b>{scan.summary.score}</b> · Grade: <b>{scan.summary.grade}</b></p>
            </CardContent>
          </Card>
        )}

        {scan?.findings?.length > 0 && (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader><CardTitle>Findings, WCAG Evidence, and Remediation Cards</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {scan.findings.slice(0, 20).map((f: any) => (
                <div key={f.id} className="border border-zinc-800 rounded p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{f.description}</div>
                    <Badge>{f.impact}</Badge>
                  </div>
                  <div className="text-xs text-zinc-400">{f.pageUrl} · selector: {f.selector}</div>
                  <div className="text-xs">Fix: {f.remediation?.suggestedFix}</div>
                  <pre className="bg-zinc-950 p-2 rounded text-xs overflow-x-auto">{f.remediation?.codeSnippet}</pre>
                  <div className="text-xs text-zinc-400">
                    WCAG refs: {(f.wcagEvidence || []).map((e: any) => (
                      <a key={e.sourceUrl} href={e.sourceUrl} target="_blank" className="underline mr-2">{e.criterion}</a>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader><CardTitle>Scan History + Compare Last Scan</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {history.map((item) => (
              <div key={item.id} className="border border-zinc-800 rounded p-2 flex justify-between items-center text-sm">
                <div>
                  <div>#{item.id} · {item.domain}</div>
                  <div className="text-xs text-zinc-500">{item.status} · {new Date(item.createdAt).toLocaleString()}</div>
                </div>
                {scan && item.id !== scan.id && (
                  <Button
                    variant="outline"
                    onClick={async () => setCompareResult(await compareScans(scan.id, item.id))}
                  >
                    Compare with current
                  </Button>
                )}
              </div>
            ))}
            {compareResult && (
              <div className="text-sm border border-zinc-800 rounded p-3">
                repeated: {compareResult.repeatedIssueCount}, resolved: {compareResult.resolvedIssueCount}, new: {compareResult.newIssueCount}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
