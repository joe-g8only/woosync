import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Import sessions (in-memory equivalent — we store them in SQLite for simplicity)
export const importSessions = sqliteTable("import_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storeUrl: text("store_url").notNull(),
  consumerKey: text("consumer_key").notNull(),
  consumerSecret: text("consumer_secret").notNull(),
  storeName: text("store_name"),
  createdAt: integer("created_at").notNull(),
});

// Import run logs
export const importRuns = sqliteTable("import_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(),
  mode: text("mode").notNull(), // update_all | add_new | prices_only | stock_only
  fileName: text("file_name").notNull(),
  totalRows: integer("total_rows").notNull().default(0),
  processed: integer("processed").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  created: integer("created").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  status: text("status").notNull().default("pending"), // pending | running | complete | failed
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
});

// Row-level results
export const importResults = sqliteTable("import_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").notNull(),
  rowNumber: integer("row_number").notNull(),
  sku: text("sku"),
  wooProductId: integer("woo_product_id"),
  productName: text("product_name"),
  matchStatus: text("match_status"), // found | not_found | multiple | error
  action: text("action"), // updated | created | skipped | error | updated_with_warnings
  updatedFields: text("updated_fields"), // JSON array of field names
  fieldChanges: text("field_changes"),   // JSON array of {field, oldValue, newValue}
  warnings: text("warnings"), // JSON array
  errorMessage: text("error_message"),
});

// Saved store profiles — one-click reconnect
export const storeProfiles = sqliteTable("store_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),           // user-chosen label e.g. "My Main Store"
  storeUrl: text("store_url").notNull(),
  consumerKey: text("consumer_key").notNull(),
  consumerSecret: text("consumer_secret").notNull(),
  storeName: text("store_name"),          // fetched from WooCommerce on save
  wpUsername: text("wp_username"),        // optional WP Application Password username
  wpAppPassword: text("wp_app_password"), // optional WP Application Password
  openaiApiKey: text("openai_api_key"),   // optional OpenAI API key for AI rewrites
  lastUsedAt: integer("last_used_at"),
  createdAt: integer("created_at").notNull(),
});

// Field mappings — per-session meta key configuration
export const fieldMappings = sqliteTable("field_mappings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull().unique(),
  msrpKey: text("msrp_key").notNull().default("_msrp"),
  costKey: text("cost_key").notNull().default("_wc_cog_cost"),
  keyFeaturesKey: text("key_features_key").notNull().default("_key_features"),
});

// Insert schemas
export const insertSessionSchema = createInsertSchema(importSessions).omit({ id: true, createdAt: true });
export const insertRunSchema = createInsertSchema(importRuns).omit({ id: true, createdAt: true, completedAt: true });
export const insertResultSchema = createInsertSchema(importResults).omit({ id: true });
export const insertFieldMappingSchema = createInsertSchema(fieldMappings).omit({ id: true });
export const upsertFieldMappingSchema = insertFieldMappingSchema;

export const insertStoreProfileSchema = createInsertSchema(storeProfiles).omit({ id: true, createdAt: true, lastUsedAt: true });
export const upsertStoreProfileSchema = insertStoreProfileSchema;

// Types
export type ImportSession = typeof importSessions.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;

export type ImportRun = typeof importRuns.$inferSelect;
export type InsertRun = z.infer<typeof insertRunSchema>;

export type ImportResult = typeof importResults.$inferSelect;
export type InsertResult = z.infer<typeof insertResultSchema>;

export type FieldMapping = typeof fieldMappings.$inferSelect;
export type InsertFieldMapping = z.infer<typeof insertFieldMappingSchema>;

export type StoreProfile = typeof storeProfiles.$inferSelect;
export type InsertStoreProfile = z.infer<typeof insertStoreProfileSchema>;

/** A single field-level change captured during real import */
export interface FieldChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

// ── Conflict Resolution types (never persisted) ─────────────────────────────

/** One candidate product returned when a SKU has multiple matches */
export interface SkuCandidate {
  id: number;
  name: string;
  status: string;
  regular_price: string;
  sale_price: string;
  stock_quantity: number | null;
  stock_status: string;
  permalink: string;
  imageUrl: string | null;
}

/** A SKU that matched more than one WooCommerce product */
export interface SkuConflict {
  sku: string;
  rowNumbers: number[];   // which CSV rows reference this SKU
  candidates: SkuCandidate[];
}

/** Result of the pre-check scan */
export interface PreCheckResult {
  totalSkus: number;
  conflicts: SkuConflict[];
  notFoundSkus: string[];
}

/** Map of sku → chosen productId — sent with the import/dry-run request */
export type ConflictResolutions = Record<string, number>;

// Dry-run types (never persisted — returned directly from /api/dry-run)
export interface DryRunChange {
  field: string;
  oldValue: string | null;
  newValue: string;
}

export interface DryRunRow {
  rowNumber: number;
  sku: string;
  productName: string | null;
  wooProductId: number | null;
  matchStatus: "found" | "not_found" | "multiple" | "no_sku";
  action: "would_update" | "would_create" | "would_skip" | "error";
  changes: DryRunChange[];
  warnings: string[];
  errorMessage: string | null;
}

export interface DryRunResult {
  mode: string;
  fileName: string;
  totalRows: number;
  wouldUpdate: number;
  wouldCreate: number;
  wouldSkip: number;
  errors: number;
  rows: DryRunRow[];
}

// App-level types
export type ImportMode = "update_all" | "add_new" | "prices_only" | "stock_only";

export const IMPORT_MODES: { value: ImportMode; label: string; description: string; icon: string }[] = [
  {
    value: "update_all",
    label: "Update Everything",
    description: "Updates matching products and creates new ones where SKUs don't exist.",
    icon: "RefreshCw",
  },
  {
    value: "add_new",
    label: "Add New Products Only",
    description: "Creates draft products for SKUs that don't already exist in the store.",
    icon: "PlusCircle",
  },
  {
    value: "prices_only",
    label: "Update Prices Only",
    description: "Updates only pricing fields for matching products. Safe for price maintenance.",
    icon: "DollarSign",
  },
  {
    value: "stock_only",
    label: "Update Stock Only",
    description: "Updates stock quantity and in-stock status for matching products.",
    icon: "Package",
  },
];

export const REQUIRED_FIELDS: Record<ImportMode, string[]> = {
  update_all: ["SKU"],
  add_new: ["SKU", "Name"],
  prices_only: ["SKU"],
  stock_only: ["SKU"],
};
