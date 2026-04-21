import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { Scan } from "@shared/schema";

const DB_DIR = path.resolve("data");
const DB_FILE = path.join(DB_DIR, "scans.json");

type ScanDb = {
  nextId: number;
  scans: Scan[];
};

const INITIAL_DB: ScanDb = { nextId: 1, scans: [] };

async function readDb(): Promise<ScanDb> {
  try {
    const content = await readFile(DB_FILE, "utf-8");
    return JSON.parse(content) as ScanDb;
  } catch {
    await mkdir(DB_DIR, { recursive: true });
    await writeFile(DB_FILE, JSON.stringify(INITIAL_DB, null, 2));
    return structuredClone(INITIAL_DB);
  }
}

async function writeDb(db: ScanDb): Promise<void> {
  await mkdir(DB_DIR, { recursive: true });
  await writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

export class JsonStorage {
  async createScan(scan: Omit<Scan, "id">): Promise<Scan> {
    const db = await readDb();
    const record: Scan = { ...scan, id: db.nextId++ };
    db.scans.push(record);
    await writeDb(db);
    return record;
  }

  async updateScan(id: number, patch: Partial<Scan>): Promise<Scan | undefined> {
    const db = await readDb();
    const idx = db.scans.findIndex((scan) => scan.id === id);
    if (idx === -1) return undefined;
    db.scans[idx] = { ...db.scans[idx], ...patch, id };
    await writeDb(db);
    return db.scans[idx];
  }

  async getScan(id: number): Promise<Scan | undefined> {
    const db = await readDb();
    return db.scans.find((scan) => scan.id === id);
  }

  async listScans(): Promise<Scan[]> {
    const db = await readDb();
    return db.scans.sort((a, b) => b.id - a.id);
  }

  async findPreviousScanForDomain(domain: string, excludeId?: number): Promise<Scan | undefined> {
    const db = await readDb();
    return db.scans
      .filter((scan) => scan.domain === domain && scan.id !== excludeId)
      .sort((a, b) => b.id - a.id)[0];
  }
}

export const storage = new JsonStorage();
