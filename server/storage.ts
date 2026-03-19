import type { Scan, InsertScan } from "@shared/schema";

export interface IStorage {
  createScan(scan: InsertScan): Promise<Scan>;
  getScan(id: number): Promise<Scan | undefined>;
  updateScan(id: number, data: Partial<InsertScan>): Promise<Scan | undefined>;
  getAllScans(): Promise<Scan[]>;
}

export class MemStorage implements IStorage {
  private scans: Map<number, Scan> = new Map();
  private nextId = 1;

  async createScan(scan: InsertScan): Promise<Scan> {
    const id = this.nextId++;
    const newScan: Scan = {
      id,
      url: scan.url,
      score: scan.score ?? null,
      grade: scan.grade ?? null,
      totalViolations: scan.totalViolations ?? null,
      criticalCount: scan.criticalCount ?? null,
      seriousCount: scan.seriousCount ?? null,
      moderateCount: scan.moderateCount ?? null,
      minorCount: scan.minorCount ?? null,
      violations: scan.violations ?? null,
      fixes: scan.fixes ?? null,
      agentLog: scan.agentLog ?? null,
      status: scan.status ?? "pending",
    };
    this.scans.set(id, newScan);
    return newScan;
  }

  async getScan(id: number): Promise<Scan | undefined> {
    return this.scans.get(id);
  }

  async updateScan(id: number, data: Partial<InsertScan>): Promise<Scan | undefined> {
    const existing = this.scans.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.scans.set(id, updated);
    return updated;
  }

  async getAllScans(): Promise<Scan[]> {
    return Array.from(this.scans.values()).reverse();
  }
}

export const storage = new MemStorage();
