export interface ScanSettings {
  url: string;
  maxDepth: number;
  pageLimit: number;
  enableCrossCheck: boolean;
}

export async function createScan(settings: ScanSettings): Promise<{ scanId: number }> {
  const response = await fetch('/api/scans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Failed to create scan: ${message}`);
  }

  return response.json();
}

export async function getScan(scanId: number) {
  const response = await fetch(`/api/scans/${scanId}`);
  if (!response.ok) {
    throw new Error('Scan not found');
  }
  return response.json();
}

export async function getScanHistory() {
  const response = await fetch('/api/scans');
  if (!response.ok) {
    throw new Error('Failed to fetch scan history');
  }
  return response.json();
}

export async function compareScans(scanId: number, otherScanId: number) {
  const response = await fetch(`/api/scans/${scanId}/compare/${otherScanId}`);
  if (!response.ok) {
    throw new Error('Failed to compare scans');
  }
  return response.json();
}
