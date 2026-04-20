import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import {
  importSessions,
  importRuns,
  importResults,
  fieldMappings,
  storeProfiles,
  type ImportSession,
  type InsertSession,
  type ImportRun,
  type InsertRun,
  type ImportResult,
  type InsertResult,
  type FieldMapping,
  type StoreProfile,
} from "@shared/schema";
import { eq } from "drizzle-orm";

// Use /data/woo_tool.db on Railway (persistent volume) or local file in dev
import fs from "fs";
import path from "path";
const DB_PATH = process.env.DATABASE_PATH || "woo_tool.db";
// Ensure the directory exists before opening the database
const DB_DIR = path.dirname(DB_PATH);
if (DB_DIR !== "." && !fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}
const sqlite = new Database(DB_PATH);
export const db = drizzle(sqlite);

// Initialize tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS import_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_url TEXT NOT NULL,
    consumer_key TEXT NOT NULL,
    consumer_secret TEXT NOT NULL,
    store_name TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS import_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    mode TEXT NOT NULL,
    file_name TEXT NOT NULL,
    total_rows INTEGER NOT NULL DEFAULT 0,
    processed INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS import_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    row_number INTEGER NOT NULL,
    sku TEXT,
    woo_product_id INTEGER,
    product_name TEXT,
    match_status TEXT,
    action TEXT,
    updated_fields TEXT,
    warnings TEXT,
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS field_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL UNIQUE,
    msrp_key TEXT NOT NULL DEFAULT '_msrp',
    cost_key TEXT NOT NULL DEFAULT '_wc_cog_cost',
    key_features_key TEXT NOT NULL DEFAULT '_key_features'
  );

  CREATE TABLE IF NOT EXISTS store_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    store_url TEXT NOT NULL,
    consumer_key TEXT NOT NULL,
    consumer_secret TEXT NOT NULL,
    store_name TEXT,
    last_used_at INTEGER,
    created_at INTEGER NOT NULL
  );
`);

// Migrate: add field_changes column if it doesn't exist yet
try {
  sqlite.exec(`ALTER TABLE import_results ADD COLUMN field_changes TEXT;`);
} catch (_) { /* column already exists */ }

export interface IStorage {
  // Sessions
  createSession(data: InsertSession & { createdAt: number }): ImportSession;
  getSession(id: number): ImportSession | undefined;
  deleteSession(id: number): void;

  // Runs
  createRun(data: Omit<InsertRun, "status"> & { createdAt: number }): ImportRun;
  updateRun(id: number, data: Partial<ImportRun>): ImportRun | undefined;
  getRun(id: number): ImportRun | undefined;
  getRunsBySession(sessionId: number): ImportRun[];

  // Results
  createResult(data: InsertResult): ImportResult;
  getResultsByRun(runId: number): ImportResult[];

  // Field mappings
  getFieldMapping(sessionId: number): FieldMapping | undefined;
  upsertFieldMapping(sessionId: number, data: { msrpKey: string; costKey: string; keyFeaturesKey: string }): FieldMapping;
  // Store profiles
  listProfiles(): StoreProfile[];
  getProfile(id: number): StoreProfile | undefined;
  createProfile(data: { name: string; storeUrl: string; consumerKey: string; consumerSecret: string; storeName?: string }): StoreProfile;
  updateProfile(id: number, data: Partial<{ name: string; storeUrl: string; consumerKey: string; consumerSecret: string; storeName: string; lastUsedAt: number }>): StoreProfile | undefined;
  deleteProfile(id: number): void;
}

export const storage: IStorage = {
  createSession(data) {
    return db.insert(importSessions).values(data).returning().get() as ImportSession;
  },
  getSession(id) {
    return db.select().from(importSessions).where(eq(importSessions.id, id)).get() as ImportSession | undefined;
  },
  deleteSession(id) {
    db.delete(importSessions).where(eq(importSessions.id, id)).run();
  },
  createRun(data) {
    return db.insert(importRuns).values({ ...data, status: "pending" }).returning().get() as ImportRun;
  },
  updateRun(id, data) {
    return db.update(importRuns).set(data).where(eq(importRuns.id, id)).returning().get() as ImportRun | undefined;
  },
  getRun(id) {
    return db.select().from(importRuns).where(eq(importRuns.id, id)).get() as ImportRun | undefined;
  },
  getRunsBySession(sessionId) {
    return db.select().from(importRuns).where(eq(importRuns.sessionId, sessionId)).all() as ImportRun[];
  },
  createResult(data) {
    return db.insert(importResults).values(data).returning().get() as ImportResult;
  },
  getResultsByRun(runId) {
    return db.select().from(importResults).where(eq(importResults.runId, runId)).all() as ImportResult[];
  },
  getFieldMapping(sessionId) {
    return db.select().from(fieldMappings).where(eq(fieldMappings.sessionId, sessionId)).get() as FieldMapping | undefined;
  },
  upsertFieldMapping(sessionId, data) {
    const existing = db.select().from(fieldMappings).where(eq(fieldMappings.sessionId, sessionId)).get();
    if (existing) {
      return db.update(fieldMappings)
        .set({ msrpKey: data.msrpKey, costKey: data.costKey, keyFeaturesKey: data.keyFeaturesKey })
        .where(eq(fieldMappings.sessionId, sessionId))
        .returning().get() as FieldMapping;
    }
    return db.insert(fieldMappings)
      .values({ sessionId, msrpKey: data.msrpKey, costKey: data.costKey, keyFeaturesKey: data.keyFeaturesKey })
      .returning().get() as FieldMapping;
  },
  // ── Store profiles ──────────────────────────────────────────────────────────
  listProfiles() {
    return db.select().from(storeProfiles)
      .all() as StoreProfile[];
  },
  getProfile(id) {
    return db.select().from(storeProfiles).where(eq(storeProfiles.id, id)).get() as StoreProfile | undefined;
  },
  createProfile(data) {
    return db.insert(storeProfiles)
      .values({ ...data, storeName: data.storeName ?? null, createdAt: Date.now(), lastUsedAt: Date.now() })
      .returning().get() as StoreProfile;
  },
  updateProfile(id, data) {
    return db.update(storeProfiles).set(data).where(eq(storeProfiles.id, id)).returning().get() as StoreProfile | undefined;
  },
  deleteProfile(id) {
    db.delete(storeProfiles).where(eq(storeProfiles.id, id)).run();
  },
};
