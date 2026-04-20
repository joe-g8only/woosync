import type { Express } from "express";
import type { Server } from "http";
import express from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import {
  testConnection,
  createWooClient,
  findProductBySku,
  updateProduct,
  createProduct,
  buildUpdatePayload,
  buildCreatePayload,
  diffProductPayload,
  resolveCategoryIds,
  resolveBrandId,
  normalizeUrl,
  DEFAULT_FIELD_MAPPING,
  type FieldMappingConfig,
} from "./woocommerce";
import type { DryRunRow, DryRunResult, SkuConflict, SkuCandidate, PreCheckResult, ConflictResolutions } from "@shared/schema";
import { storage } from "./storage";
import { processImagesForProduct, processImagesWithWpUpload, cleanupTempImages, TMP_IMAGE_DIR } from "./image_processor";
import { rewriteDescription } from "./ai_rewriter";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

/** Strip UTF-8 BOM (0xEF 0xBB 0xBF) so Excel-exported CSVs parse cleanly */
/** Safely serialize a payload value for fieldChanges display */
function serializeFieldValue(v: any): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v) || (typeof v === "object")) return JSON.stringify(v);
  return String(v);
}

const stripBom = (buf: Buffer): string => {
  const str = buf.toString("utf-8");
  return str.charCodeAt(0) === 0xfeff ? str.slice(1) : str;
};

/**
 * Apply a column map to a record set.
 * columnMap = { "SourceColumnName": "Target WooCommerce Column" }
 * Source columns that map to "" or "(ignore)" are dropped.
 * Columns not in the map are kept as-is.
 */
function applyColumnMap(
  records: Record<string, any>[],
  columnMap: Record<string, string>
): Record<string, any>[] {
  if (!columnMap || Object.keys(columnMap).length === 0) return records;
  return records.map((row) => {
    const newRow: Record<string, any> = {};
    for (const [srcCol, val] of Object.entries(row)) {
      const target = columnMap[srcCol];
      if (target === undefined) {
        // Not in map — keep original
        newRow[srcCol] = val;
      } else if (target === "" || target === "(ignore)") {
        // Explicitly ignored — drop
      } else {
        newRow[target] = val;
      }
    }
    return newRow;
  });
}

// In-memory session store (keyed by session ID)
const sessionStore: Record<
  number,
  { storeUrl: string; consumerKey: string; consumerSecret: string; storeName?: string; wpUsername?: string; wpAppPassword?: string }
> = {};

/**
 * Look up a session — first from in-memory store, then from SQLite.
 * Re-hydrates sessionStore on a SQLite hit so subsequent calls within
 * the same server process don't need another DB round-trip.
 */
function getSession(id: number) {
  if (sessionStore[id]) return sessionStore[id];
  const dbSess = storage.getSession(id);
  if (dbSess) {
    sessionStore[id] = {
      storeUrl: dbSess.storeUrl,
      consumerKey: dbSess.consumerKey,
      consumerSecret: dbSess.consumerSecret,
      storeName: (dbSess as any).storeName,
    };
    return sessionStore[id];
  }
  return null;
}

export async function registerRoutes(httpServer: Server, app: Express) {
  // ─── TEMP IMAGE SERVER ────────────────────────────────────────────────────
  // Processed images are saved to TMP_IMAGE_DIR and served here so WooCommerce
  // can sideload them into the media library.
  app.use("/tmp-images", express.static(TMP_IMAGE_DIR));

  // ─── DEV/TEST: seed an in-memory session without WooCommerce validation ───
  // Only available in non-production builds for QA purposes
  if (process.env.NODE_ENV !== "production") {
    app.post("/api/test-session", (req, res) => {
      const { sessionId, storeUrl, consumerKey, consumerSecret, storeName } = req.body;
      const id = parseInt(sessionId);
      sessionStore[id] = { storeUrl, consumerKey, consumerSecret, storeName };
      return res.json({ ok: true, sessionId: id });
    });
  }

  // ─── STORE CONNECTION ─────────────────────────────────────────────────────
  app.post("/api/connect", async (req, res) => {
    const { storeUrl, consumerKey, consumerSecret, wpUsername, wpAppPassword } = req.body;
    if (!storeUrl || !consumerKey || !consumerSecret) {
      return res.status(400).json({ error: "All fields are required." });
    }
    const result = await testConnection({ storeUrl, consumerKey, consumerSecret });
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    const session = storage.createSession({
      storeUrl: normalizeUrl(storeUrl),
      consumerKey,
      consumerSecret,
      storeName: result.storeName,
      createdAt: Date.now(),
    });
    const openaiApiKey = req.body.openaiApiKey as string | undefined;
    sessionStore[session.id] = {
      storeUrl: normalizeUrl(storeUrl),
      consumerKey,
      consumerSecret,
      storeName: result.storeName,
      wpUsername: wpUsername || undefined,
      wpAppPassword: wpAppPassword || undefined,
      openaiApiKey: openaiApiKey || undefined,
    };
    return res.json({ sessionId: session.id, storeName: result.storeName, storeUrl: normalizeUrl(storeUrl) });
  });

  app.delete("/api/connect/:sessionId", (req, res) => {
    const id = parseInt(req.params.sessionId);
    delete sessionStore[id];
    storage.deleteSession(id);
    return res.json({ success: true });
  });

  app.get("/api/session/:sessionId", (req, res) => {
    const id = parseInt(req.params.sessionId);
    const sess = getSession(id);
    if (!sess) return res.status(404).json({ error: "Session not found" });
    return res.json({ storeUrl: sess.storeUrl, storeName: (sess as any).storeName });
  });

  // ─── CSV UPLOAD & PARSE ───────────────────────────────────────────────────
  app.post("/api/upload/:sessionId", upload.single("csv"), async (req, res) => {
    const id = parseInt(req.params.sessionId);
    const sess = getSession(id);
    if (!sess) return res.status(401).json({ error: "Session not found. Please reconnect." });
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    try {
      const content = stripBom(req.file.buffer);
      const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      }) as Record<string, any>[];

      const columns = Object.keys(records[0] || {});
      const preview = records.slice(0, 5);
      const total = records.length;
      const hasSku = columns.some((c) => c.toLowerCase().includes("sku"));

      // Extract all category values (lightweight — 3 cols × N rows) for the tree preview.
      // We pick up the raw column names here; the client will re-apply its columnMap later.
      const catCols = ["Category Level 1", "Category Level 2", "Category Level 3",
                       "Categories", "Subcategory", "Sub-Subcategory"];
      const categoryRows: { l1: string; l2: string; l3: string }[] = records.map((r) => ({
        l1: String(r["Category Level 1"] || r["Categories"] || r["Category"] || "").trim(),
        l2: String(r["Category Level 2"] || r["Subcategory"] || "").trim(),
        l3: String(r["Category Level 3"] || r["Sub-Subcategory"] || "").trim(),
      }));

      return res.json({
        columns,
        preview,
        total,
        hasSku,
        fileName: req.file.originalname,
        categoryRows,
        // Note: full rows are NOT sent to client — they are re-parsed from the CSV on import
      });
    } catch (err: any) {
      return res.status(400).json({ error: "Could not parse CSV: " + (err.message || "unknown error") });
    }
  });

  // ─── SKU MATCH CHECK (legacy) ────────────────────────────────────────────
  app.post("/api/sku-check/:sessionId", async (req, res) => {
    const id = parseInt(req.params.sessionId);
    const sess = getSession(id);
    if (!sess) return res.status(401).json({ error: "Session not found." });

    const { skus } = req.body as { skus: string[] };
    if (!Array.isArray(skus) || skus.length === 0) {
      return res.status(400).json({ error: "No SKUs provided." });
    }

    const client = createWooClient(sess);
    const results: { sku: string; status: string; productName?: string; productId?: number }[] = [];

    const sample = skus.slice(0, 20);
    for (const sku of sample) {
      const r = await findProductBySku(client, sku);
      results.push({
        sku,
        status: r.status,
        productName: r.product?.name,
        productId: r.product?.id,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return res.json({ results });
  });

  // ─── PRE-CHECK: scan CSV for conflicting SKUs ─────────────────────────────
  // Accepts a CSV upload, finds all SKUs that match multiple products.
  // Returns conflicts (with all candidates) and not-found SKUs.
  // Does NOT run the import. Client uses this to show the conflict resolution screen.
  app.post("/api/pre-check/:sessionId", upload.single("csv"), async (req, res) => {
    const id = parseInt(req.params.sessionId);
    const sess = getSession(id);
    if (!sess) return res.status(401).json({ error: "Session not found." });
    if (!req.file) return res.status(400).json({ error: "No CSV file provided." });

    // Column map from pre-check form (same map used later for import)
    let preCheckColumnMap: Record<string, string> = {};
    try {
      if (req.body.columnMap) preCheckColumnMap = JSON.parse(req.body.columnMap);
    } catch { /* ignore */ }

    let records: Record<string, any>[];
    try {
      const content = stripBom(req.file.buffer);
      const raw = parse(content, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
      records = applyColumnMap(raw, preCheckColumnMap);
    } catch {
      return res.status(400).json({ error: "Could not parse CSV." });
    }

    // Collect unique SKUs and their row numbers
    const skuRowMap: Map<string, number[]> = new Map();
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const skuRaw = row["SKU"] || row["sku"] || "";
      const sku = String(skuRaw).trim();
      if (!sku) continue;
      if (!skuRowMap.has(sku)) skuRowMap.set(sku, []);
      skuRowMap.get(sku)!.push(i + 1);
    }

    const client = createWooClient(sess);
    const conflicts: SkuConflict[] = [];
    const notFoundSkus: string[] = [];

    for (const [sku, rowNumbers] of skuRowMap.entries()) {
      const match = await findProductBySku(client, sku);
      if (match.status === "multiple" && match.products) {
        const candidates: SkuCandidate[] = match.products.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          regular_price: p.regular_price || "",
          sale_price: p.sale_price || "",
          stock_quantity: p.stock_quantity,
          stock_status: p.stock_status,
          permalink: p.permalink || "",
          imageUrl: p.images?.[0]?.src || null,
        }));
        conflicts.push({ sku, rowNumbers, candidates });
      } else if (match.status === "not_found") {
        notFoundSkus.push(sku);
      }
      await new Promise((r) => setTimeout(r, 80));
    }

    const result: PreCheckResult = {
      totalSkus: skuRowMap.size,
      conflicts,
      notFoundSkus,
    };
    return res.json(result);
  });

  // ─── IMPORT / RUN ─────────────────────────────────────────────────────────
  app.post("/api/import/:sessionId", upload.single("csv"), async (req, res) => {
    const id = parseInt(req.params.sessionId);
    const sess = getSession(id);
    if (!sess) return res.status(401).json({ error: "Session not found." });
    if (!req.file) return res.status(400).json({ error: "No CSV file provided." });

    const mode = req.body.mode as string;
    const validModes = ["update_all", "add_new", "prices_only", "stock_only"];
    if (!validModes.includes(mode)) return res.status(400).json({ error: "Invalid import mode." });

    // processImages=true enables the download/pad/resize pipeline for Images column
    const processImages = req.body.processImages === "true" || req.body.processImages === true;

    // SKUs explicitly omitted by the user in the Review & Omit step
    let omittedSkus: Set<string> = new Set();
    try {
      const raw = req.body.omittedSkus;
      if (raw) {
        const parsed: string[] = JSON.parse(raw);
        omittedSkus = new Set(parsed.map((s) => String(s).trim()));
      }
    } catch (_) {}

    // Conflict resolutions: map of sku → chosen productId
    let resolutions: ConflictResolutions = {};
    try {
      if (req.body.resolutions) resolutions = JSON.parse(req.body.resolutions);
    } catch { /* ignore malformed */ }

    // Column map: { "SourceColumn": "WooCommerce Column" } — applied before any field reading
    let columnMap: Record<string, string> = {};
    try {
      if (req.body.columnMap) columnMap = JSON.parse(req.body.columnMap);
    } catch { /* ignore malformed */ }

    // AI rewrite config
    const aiRewrite = req.body.aiRewrite === "true" || req.body.aiRewrite === true;
    const aiDescriptionSourceCol: string = req.body.aiDescriptionSourceCol || "Description";
    const aiNameSourceCol: string = req.body.aiNameSourceCol || "Name";
    const aiBrandSourceCol: string = req.body.aiBrandSourceCol || "Brand";
    // Inline key from the panel overrides the session key
    if (req.body.aiOpenaiApiKey) sess.openaiApiKey = req.body.aiOpenaiApiKey;

    // Resolve field mapping for this session (fall back to defaults if not configured)
    const fmRecord = storage.getFieldMapping(id);
    const fm: FieldMappingConfig = fmRecord
      ? { msrpKey: fmRecord.msrpKey, costKey: fmRecord.costKey, keyFeaturesKey: fmRecord.keyFeaturesKey }
      : DEFAULT_FIELD_MAPPING;

    let records: Record<string, any>[];
    try {
      const content = stripBom(req.file.buffer);
      let rawRecords = parse(content, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
      records = applyColumnMap(rawRecords, columnMap);
    } catch {
      return res.status(400).json({ error: "Could not parse CSV." });
    }

    const run = storage.createRun({
      sessionId: id,
      mode,
      fileName: req.file.originalname,
      totalRows: records.length,
      processed: 0,
      updated: 0,
      created: 0,
      skipped: 0,
      errors: 0,
      createdAt: Date.now(),
    });

    storage.updateRun(run.id, { status: "running" });

    // Respond immediately with runId — client will poll /api/runs/:id/results for progress
    res.json({ runId: run.id, status: "running" });

    // Process the import in the background (fire-and-forget)
    setImmediate(async () => {
    const client = createWooClient(sess);
    let updated = 0, created = 0, skipped = 0, errors = 0;

    // Per-run category name → ID cache so we don’t re-fetch the same category for every row
    const categoryCache = new Map<string, number>();
    const brandCache = new Map<string, number>();

    /**
     * Extract the category hierarchy from a row and resolve to WooCommerce IDs.
     * Uses the three mapped fields: Categories (L1), Subcategory (L2), Sub-Subcategory (L3).
     * Results are injected directly into the payload.
     */
    async function resolveCategoriesForRow(
      row: Record<string, any>,
      payload: Record<string, any>,
      rowWarnings: string[]
    ): Promise<void> {
      const l1 = String(row["Categories"] || row["Category Level 1"] || "").trim();
      const l2 = String(row["Subcategory"] || row["Category Level 2"] || "").trim();
      const l3 = String(row["Sub-Subcategory"] || row["Category Level 3"] || "").trim();
      if (!l1 && !l2 && !l3) return; // no category data — leave payload.categories untouched
      try {
        const ids = await resolveCategoryIds(client, { l1, l2, l3 }, categoryCache);
        if (ids.length) payload.categories = ids;
      } catch (catErr: any) {
        rowWarnings.push(`Category resolution failed: ${catErr?.message || "unknown"} — categories not assigned.`);
      }
    }

    /**
     * Resolve the Brand column to a WooCommerce brand taxonomy term ID.
     * Injects brands: [{ id }] into the payload.
     */
    async function resolveBrandForRow(
      row: Record<string, any>,
      payload: Record<string, any>,
      rowWarnings: string[]
    ): Promise<void> {
      const brandName = String(row["Brands"] || row["Brand"] || "").trim();
      if (!brandName) return;
      try {
        const brand = await resolveBrandId(client, brandName, brandCache);
        if (brand !== null) {
          // Use the dynamically detected payload key ("brands" for WC 9.6, "pwb-brand" for PWB plugin)
          // WC 9.6 built-in brands expects [{ id }] only — same format as categories
          // PWB plugin expects [{ id, name, slug }]
          const brandPayload = brand.payloadKey === "brands"
            ? [{ id: brand.id }]
            : [{ id: brand.id, name: brand.name, slug: brand.slug }];
          payload[brand.payloadKey] = brandPayload;
        } else {
          rowWarnings.push(`Brand "${brandName}" could not be resolved — brand not assigned.`);
        }
      } catch (brandErr: any) {
        rowWarnings.push(`Brand resolution failed: ${brandErr?.message || "unknown"} — brand not assigned.`);
      }
    }

    // ── Helper: resolve images for a row ──────────────────────────────────────
    // When processImages=true:
    //   - If wpUsername + wpAppPassword are set: download → process → upload to wp/v2/media
    //   - Otherwise: download → process → save locally → pass src URLs (WC sideloads)
    // When processImages=false: pass original URLs through as-is
    async function resolveImages(
      row: Record<string, any>,
      rowWarnings: string[]
    ): Promise<{ src: string }[] | null> {
      const rawImages = row["Images"] || row["images"] || "";
      if (!String(rawImages).trim()) return null; // blank → skip, don't overwrite

      if (!processImages) {
        // Image processing not enabled — pass URLs through as-is
        const raw = String(rawImages);
        const urls = (raw.includes("|") ? raw.split("|") : raw.split(","))
          .map((u: string) => u.trim()).filter(Boolean);
        return urls.map((src: string) => ({ src }));
      }

      // If WP credentials are available, use them for direct media upload
      if (sess.wpUsername && sess.wpAppPassword) {
        const { wooImages, warnings: imgWarnings, errors: imgErrors } = await processImagesWithWpUpload(
          String(rawImages),
          sess.storeUrl,
          sess.wpUsername,
          sess.wpAppPassword
        );
        rowWarnings.push(...imgWarnings);
        if (imgErrors.length > 0 && wooImages.length === 0) {
          rowWarnings.push(`All ${imgErrors.length} image(s) failed — images not updated.`);
          return null;
        }
        if (imgErrors.length > 0) imgErrors.forEach((e) => rowWarnings.push(e));
        return wooImages.length > 0 ? wooImages : null;
      }

      // No WP credentials — pass original source URLs directly to WooCommerce for sideloading.
      // We cannot serve locally-processed images because our Express server is not reachable
      // from the WooCommerce server. WooCommerce can sideload from the original CDN/host URLs fine.
      const raw = String(rawImages);
      const urls = (raw.includes("|") ? raw.split("|") : raw.split(","))
        .map((u: string) => u.trim()).filter(Boolean);
      if (urls.length === 0) return null;
      return urls.map((src: string) => ({ src }));
    }

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 1;

      // ── OUTER try/catch: one bad row must never kill the entire run ──
      try {

      const skuRaw = row["SKU"] || row["sku"] || "";
      const sku = String(skuRaw).trim();

      if (!sku) {
        storage.createResult({
          runId: run.id,
          rowNumber: rowNum,
          sku: null,
          matchStatus: "error",
          action: "skipped",
          warnings: null,
          updatedFields: null,
          fieldChanges: null,
          errorMessage: "Missing SKU — row skipped",
          wooProductId: null,
          productName: null,
        });
        skipped++;
        continue;
      }

      // User explicitly omitted this SKU in the Review & Omit step
      if (omittedSkus.has(sku)) {
        storage.createResult({
          runId: run.id,
          rowNumber: rowNum,
          sku,
          matchStatus: "found",
          action: "skipped",
          warnings: null,
          updatedFields: null,
          fieldChanges: null,
          errorMessage: null,
          wooProductId: null,
          productName: row["Name"] || null,
        });
        skipped++;
        continue;
      }

      const match = await findProductBySku(client, sku);
      const warnings: string[] = [];

      if (match.status === "error") {
        storage.createResult({
          runId: run.id, rowNumber: rowNum, sku,
          matchStatus: "error", action: "error",
          warnings: null, updatedFields: null,
          errorMessage: match.error || "SKU lookup failed",
          wooProductId: null, productName: null,
        });
        errors++;
        continue;
      }

      // If user resolved this conflict, swap in the chosen product
      if (match.status === "multiple" && resolutions[sku] !== undefined && match.products) {
        const chosen = match.products.find((p) => p.id === resolutions[sku]);
        if (chosen) {
          (match as any).product = chosen;
          (match as any).status = "found";
        } else {
          warnings.push(`Resolved product ID ${resolutions[sku]} not found among matches — using first match.`);
        }
      }

      if (match.status === "multiple") warnings.push("Multiple products found with this SKU — updated the first match.");

      // Mode logic
      if (match.status === "found" || match.status === "multiple") {
        if (mode === "add_new") {
          storage.createResult({
            runId: run.id, rowNumber: rowNum, sku,
            matchStatus: "found", action: "skipped",
            warnings: null, updatedFields: JSON.stringify(["SKU already exists"]),
            errorMessage: null,
            wooProductId: match.product!.id,
            productName: match.product!.name,
          });
          skipped++;
          continue;
        }

        // ── AI DESCRIPTION REWRITE ── (update_all only; inject before payload build)
        if (aiRewrite && (mode === "update_all" || mode === "add_new")) {
          try {
            const srcDesc = String(row[aiDescriptionSourceCol] || row["Description"] || row["Long Description(150)"] || "").trim();
            if (srcDesc) {
              const srcName = String(row[aiNameSourceCol] || row["Name"] || "").trim();
              const srcBrand = String(row[aiBrandSourceCol] || row["Brand"] || "").trim();
              const rewritten = await rewriteDescription(srcDesc, srcName || undefined, srcBrand || undefined, undefined, sess.openaiApiKey);
              row["Short description"] = rewritten.shortDescription;
              row["Description"] = rewritten.longDescription;
              if (rewritten.keyFeatures.length) {
                row["Key Features"] = rewritten.keyFeatures.join("\n");
              }
              // Prepend Brand to Name: "Brand - Product Name"
              const rewriteBrand = String(row[aiBrandSourceCol] || row["Brand"] || "").trim();
              const rewriteName = String(row[aiNameSourceCol] || row["Name"] || "").trim();
              if (rewriteBrand && rewriteName && !rewriteName.startsWith(rewriteBrand)) {
                row["Name"] = `${rewriteBrand} - ${rewriteName}`;
              }
            }
          } catch (aiErr: any) {
            warnings.push(`AI rewrite failed: ${aiErr?.message || "unknown error"} — original description used.`);
          }
        }

        // Build base payload (with session field mapping for meta keys)
        const payload = buildUpdatePayload(mode, row, fm);

        // ── CATEGORY RESOLUTION ── (update_all only; resolve names → WooCommerce IDs)
        if (mode === "update_all") {
          await resolveCategoriesForRow(row, payload, warnings);
          await resolveBrandForRow(row, payload, warnings);
        }

        // ── IMAGE PIPELINE ── (update_all only; prices/stock modes ignore images)
        if ((mode === "update_all") && (row["Images"] || row["images"])) {
          const resolvedImages = await resolveImages(row, warnings);
          if (resolvedImages !== null) {
            payload.images = resolvedImages;
          }
          // If processImages is off, images were already set by buildUpdatePayload via URL passthrough
          // If processImages is on, we override with properly processed media IDs
        }

        const fields = Object.keys(payload).filter((k) => k !== "meta_data" && k !== "images");
        if ((payload.meta_data as any[])?.length) fields.push(...(payload.meta_data as any[]).map((m: any) => m.key));
        if (payload.images) fields.push(`images (${(payload.images as any[]).length})`);

        if (Object.keys(payload).length === 0) {
          storage.createResult({
            runId: run.id, rowNumber: rowNum, sku,
            matchStatus: "found", action: "skipped",
            warnings: JSON.stringify(["No updatable fields found in this row"]),
            updatedFields: null, errorMessage: null,
            wooProductId: match.product!.id, productName: match.product!.name,
          });
          skipped++;
          continue;
        }

        // Capture field-level old→new diff before writing
        const fieldChanges = diffProductPayload(match.product!, payload);

        const result = await updateProduct(client, match.product!.id, payload);
        if (result.success) {
          storage.createResult({
            runId: run.id, rowNumber: rowNum, sku,
            matchStatus: "found",
            action: warnings.length ? "updated_with_warnings" : "updated",
            warnings: warnings.length ? JSON.stringify(warnings) : null,
            updatedFields: JSON.stringify(fields),
            fieldChanges: fieldChanges.length ? JSON.stringify(fieldChanges) : null,
            errorMessage: null,
            wooProductId: match.product!.id,
            productName: match.product!.name,
          });
          updated++;
        } else {
          storage.createResult({
            runId: run.id, rowNumber: rowNum, sku,
            matchStatus: "found", action: "error",
            warnings: warnings.length ? JSON.stringify(warnings) : null,
            updatedFields: null,
            fieldChanges: null,
            errorMessage: result.error || "Update failed",
            wooProductId: match.product!.id, productName: match.product!.name,
          });
          errors++;
        }
      } else {
        // Not found
        if (mode === "prices_only" || mode === "stock_only") {
          storage.createResult({
            runId: run.id, rowNumber: rowNum, sku,
            matchStatus: "not_found", action: "skipped",
            warnings: null, updatedFields: null,
            errorMessage: null, wooProductId: null, productName: null,
          });
          skipped++;
          continue;
        }

        // update_all or add_new — create draft product (with session field mapping)
        // ── AI DESCRIPTION REWRITE for new products ──
        if (aiRewrite) {
          try {
            const srcDesc = String(row[aiDescriptionSourceCol] || row["Description"] || row["Long Description(150)"] || "").trim();
            if (srcDesc) {
              const srcName = String(row[aiNameSourceCol] || row["Name"] || "").trim();
              const srcBrand = String(row[aiBrandSourceCol] || row["Brand"] || "").trim();
              const rewritten = await rewriteDescription(srcDesc, srcName || undefined, srcBrand || undefined, undefined, sess.openaiApiKey);
              row["Short description"] = rewritten.shortDescription;
              row["Description"] = rewritten.longDescription;
              if (rewritten.keyFeatures.length) {
                row["Key Features"] = rewritten.keyFeatures.join("\n");
              }
              // Prepend Brand to Name: "Brand - Product Name"
              const createBrand = String(row[aiBrandSourceCol] || row["Brand"] || "").trim();
              const createName = String(row[aiNameSourceCol] || row["Name"] || "").trim();
              if (createBrand && createName && !createName.startsWith(createBrand)) {
                row["Name"] = `${createBrand} - ${createName}`;
              }
            }
          } catch (aiErr: any) {
            warnings.push(`AI rewrite failed: ${aiErr?.message || "unknown error"} — original description used.`);
          }
        }

        const payload = buildCreatePayload(row, fm);

        // ── CATEGORY RESOLUTION for new products ──
        await resolveCategoriesForRow(row, payload, warnings);
        await resolveBrandForRow(row, payload, warnings);

        // ── IMAGE PIPELINE for new products ──
        if (row["Images"] || row["images"]) {
          const resolvedImages = await resolveImages(row, warnings);
          if (resolvedImages !== null) {
            payload.images = resolvedImages;
          }
        }

        // Snapshot all new fields for created products
        const createFields = Object.keys(payload)
          .filter((k) => k !== "meta_data" && k !== "images")
          .map((k) => ({ field: k, oldValue: null, newValue: serializeFieldValue(payload[k]) }));
        if ((payload.meta_data as any[])?.length) {
          (payload.meta_data as any[]).forEach((m: any) => createFields.push({ field: m.key, oldValue: null, newValue: serializeFieldValue(m.value) }));
        }

        const result = await createProduct(client, payload);
        if (result.success) {
          const warnMsg = warnings.length ? JSON.stringify(warnings) : null;
          storage.createResult({
            runId: run.id, rowNumber: rowNum, sku,
            matchStatus: "not_found",
            action: warnings.length ? "updated_with_warnings" : "created",
            warnings: warnMsg,
            updatedFields: null,
            fieldChanges: createFields.length ? JSON.stringify(createFields) : null,
            errorMessage: null,
            wooProductId: result.productId || null,
            productName: row["Name"] || null,
          });
          created++;
        } else {
          storage.createResult({
            runId: run.id, rowNumber: rowNum, sku,
            matchStatus: "not_found", action: "error",
            warnings: warnings.length ? JSON.stringify(warnings) : null,
            updatedFields: null,
            fieldChanges: null,
            errorMessage: result.error || "Create failed",
            wooProductId: null, productName: null,
          });
          errors++;
        }
      }

      } catch (rowErr: any) {
        // Unexpected per-row error — log it as an error result and keep going
        try {
          const skuFallback = String(row?.["SKU"] || row?.["sku"] || "").trim() || null;
          storage.createResult({
            runId: run.id,
            rowNumber: rowNum,
            sku: skuFallback,
            matchStatus: "error",
            action: "error",
            warnings: null,
            updatedFields: null,
            fieldChanges: null,
            errorMessage: `Unexpected error: ${rowErr?.message || String(rowErr)}`,
            wooProductId: null,
            productName: null,
          });
        } catch (_) { /* DB write failed — nothing we can do */ }
        errors++;
      }

      storage.updateRun(run.id, { processed: i + 1, updated, created, skipped, errors });
      await new Promise((r) => setTimeout(r, 80)); // rate limiting courtesy
    }

    storage.updateRun(run.id, {
      status: "complete",
      processed: records.length,
      updated, created, skipped, errors,
      completedAt: Date.now(),
    });

    }); // end setImmediate background task
  }); // end POST /api/import/:sessionId

  // ─── FIELD MAPPINGS ──────────────────────────────────────────────────────
  // GET current field mapping for session (returns defaults if not set)
  app.get("/api/field-mapping/:sessionId", (req, res) => {
    const id = parseInt(req.params.sessionId);
    const sess = getSession(id);
    if (!sess) return res.status(404).json({ error: "Session not found" });
    const existing = storage.getFieldMapping(id);
    if (existing) return res.json(existing);
    // Return defaults without persisting
    return res.json({
      id: null,
      sessionId: id,
      msrpKey: DEFAULT_FIELD_MAPPING.msrpKey,
      costKey: DEFAULT_FIELD_MAPPING.costKey,
      keyFeaturesKey: DEFAULT_FIELD_MAPPING.keyFeaturesKey,
    });
  });

  // PUT (upsert) field mapping for session
  app.put("/api/field-mapping/:sessionId", (req, res) => {
    const id = parseInt(req.params.sessionId);
    const sess = getSession(id);
    if (!sess) return res.status(404).json({ error: "Session not found" });
    const { msrpKey, costKey, keyFeaturesKey } = req.body;
    if (!msrpKey || !costKey || !keyFeaturesKey) {
      return res.status(400).json({ error: "All three meta keys are required." });
    }
    const mapping = storage.upsertFieldMapping(id, { msrpKey, costKey, keyFeaturesKey });
    return res.json(mapping);
  });

  // ─── STORE PROFILES ────────────────────────────────────────────────────────
  app.get("/api/profiles", (_req, res) => {
    const profiles = storage.listProfiles();
    // Never return credentials in the list — only metadata for display
    return res.json(profiles.map((p) => ({
      id: p.id, name: p.name, storeUrl: p.storeUrl, storeName: p.storeName,
      lastUsedAt: p.lastUsedAt, createdAt: p.createdAt,
    })));
  });

  app.post("/api/profiles", async (req, res) => {
    const { name, storeUrl, consumerKey, consumerSecret, sessionId } = req.body;
    if (!name || !storeUrl || !consumerKey || !consumerSecret)
      return res.status(400).json({ error: "name, storeUrl, consumerKey, and consumerSecret are required." });
    // Validate credentials before saving
    const test = await testConnection({ storeUrl, consumerKey, consumerSecret });
    if (!test.success) return res.status(400).json({ error: `Could not connect: ${test.error}` });
    // Pull optional credentials from the current session if available
    const sess = sessionId ? sessionStore[parseInt(sessionId)] : undefined;
    const profile = storage.createProfile({
      name, storeUrl, consumerKey, consumerSecret, storeName: test.storeName,
      wpUsername: sess?.wpUsername || undefined,
      wpAppPassword: sess?.wpAppPassword || undefined,
      openaiApiKey: sess?.openaiApiKey || undefined,
    });
    return res.json({ id: profile.id, name: profile.name, storeUrl: profile.storeUrl, storeName: profile.storeName, createdAt: profile.createdAt });
  });

  app.delete("/api/profiles/:id", (req, res) => {
    const id = parseInt(req.params.id);
    storage.deleteProfile(id);
    return res.json({ ok: true });
  });

  // One-click connect: use saved profile to create a session
  app.post("/api/profiles/:id/connect", async (req, res) => {
    const id = parseInt(req.params.id);
    const profile = storage.getProfile(id);
    if (!profile) return res.status(404).json({ error: "Profile not found." });
    // Re-test connection to ensure keys still work
    const test = await testConnection({ storeUrl: profile.storeUrl, consumerKey: profile.consumerKey, consumerSecret: profile.consumerSecret });
    if (!test.success) return res.status(400).json({ error: `Could not connect: ${test.error}` });
    const session = storage.createSession({
      storeUrl: profile.storeUrl, consumerKey: profile.consumerKey,
      consumerSecret: profile.consumerSecret, storeName: test.storeName,
      createdAt: Date.now(),
    });
    sessionStore[session.id] = {
      storeUrl: profile.storeUrl,
      consumerKey: profile.consumerKey,
      consumerSecret: profile.consumerSecret,
      storeName: test.storeName,
      wpUsername: profile.wpUsername || undefined,
      wpAppPassword: profile.wpAppPassword || undefined,
      openaiApiKey: profile.openaiApiKey || undefined,
    };
    // Update last used
    storage.updateProfile(id, { lastUsedAt: Date.now() });
    return res.json({ sessionId: session.id, storeName: test.storeName, storeUrl: profile.storeUrl });
  });

  // ─── AI DESCRIPTION REWRITE PREVIEW ──────────────────────────────────────────────
  // POST /api/rewrite-preview — preview AI rewrite for a single description
  app.post("/api/rewrite-preview", async (req, res) => {
    const { description, productName, brand, sessionId } = req.body;
    if (!description || !String(description).trim()) {
      return res.status(400).json({ error: "description is required." });
    }
    const previewSess = sessionId ? sessionStore[parseInt(sessionId)] : undefined;
    try {
      const result = await rewriteDescription(
        String(description).trim(),
        productName ? String(productName).trim() : undefined,
        brand ? String(brand).trim() : undefined,
        undefined,
        previewSess?.openaiApiKey
      );
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "AI rewrite failed." });
    }
  });

  // ─── DRY-RUN ──────────────────────────────────────────────────────────────
  // POST /api/dry-run/:sessionId  (same multipart form as /api/import)
  app.post("/api/dry-run/:sessionId", upload.single("csv"), async (req, res) => {
    const id = parseInt(req.params.sessionId);
    const sess = getSession(id);
    if (!sess) return res.status(401).json({ error: "Session not found." });
    if (!req.file) return res.status(400).json({ error: "No CSV file provided." });

    const mode = req.body.mode as string;
    const validModes = ["update_all", "add_new", "prices_only", "stock_only"];
    if (!validModes.includes(mode)) return res.status(400).json({ error: "Invalid import mode." });

    // Conflict resolutions for dry-run
    let dryResolutions: ConflictResolutions = {};
    try {
      if (req.body.resolutions) dryResolutions = JSON.parse(req.body.resolutions);
    } catch { /* ignore */ }

    // Column map for dry-run
    let dryColumnMap: Record<string, string> = {};
    try {
      if (req.body.columnMap) dryColumnMap = JSON.parse(req.body.columnMap);
    } catch { /* ignore */ }

    let records: Record<string, any>[];
    try {
      const content = stripBom(req.file.buffer);
      const raw = parse(content, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
      records = applyColumnMap(raw, dryColumnMap);
    } catch {
      return res.status(400).json({ error: "Could not parse CSV." });
    }

    // Resolve field mapping
    const fmRecord = storage.getFieldMapping(id);
    const fm: FieldMappingConfig = fmRecord
      ? { msrpKey: fmRecord.msrpKey, costKey: fmRecord.costKey, keyFeaturesKey: fmRecord.keyFeaturesKey }
      : DEFAULT_FIELD_MAPPING;

    const client = createWooClient(sess);
    const rows: DryRunRow[] = [];
    let wouldUpdate = 0, wouldCreate = 0, wouldSkip = 0, errors = 0;

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 1;
      const skuRaw = row["SKU"] || row["sku"] || "";
      const sku = String(skuRaw).trim();

      if (!sku) {
        rows.push({ rowNumber: rowNum, sku: "", productName: null, wooProductId: null,
          matchStatus: "no_sku", action: "would_skip", changes: [], warnings: [], errorMessage: "Missing SKU" });
        wouldSkip++;
        continue;
      }

      const match = await findProductBySku(client, sku);
      const warnings: string[] = [];

      if (match.status === "error") {
        rows.push({ rowNumber: rowNum, sku, productName: null, wooProductId: null,
          matchStatus: "not_found", action: "error", changes: [], warnings: [],
          errorMessage: match.error || "SKU lookup failed" });
        errors++;
        continue;
      }

      // Honour conflict resolution choices in dry-run too
      if (match.status === "multiple" && dryResolutions[sku] !== undefined && match.products) {
        const chosen = match.products.find((p) => p.id === dryResolutions[sku]);
        if (chosen) {
          (match as any).product = chosen;
          (match as any).status = "found";
        } else {
          warnings.push(`Resolved product ID ${dryResolutions[sku]} not found — using first match.`);
        }
      }

      if (match.status === "multiple") warnings.push("Multiple products found — would update the first match.");

      if (match.status === "found" || match.status === "multiple") {
        if (mode === "add_new") {
          rows.push({ rowNumber: rowNum, sku, productName: match.product!.name,
            wooProductId: match.product!.id, matchStatus: "found", action: "would_skip",
            changes: [], warnings: [], errorMessage: null });
          wouldSkip++;
          continue;
        }
        const payload = buildUpdatePayload(mode, row, fm);
        if (Object.keys(payload).length === 0) {
          rows.push({ rowNumber: rowNum, sku, productName: match.product!.name,
            wooProductId: match.product!.id, matchStatus: "found", action: "would_skip",
            changes: [], warnings: ["No updatable fields in this row"], errorMessage: null });
          wouldSkip++;
          continue;
        }
        const changes = diffProductPayload(match.product!, payload);
        rows.push({ rowNumber: rowNum, sku, productName: match.product!.name,
          wooProductId: match.product!.id, matchStatus: match.status as any,
          action: "would_update", changes, warnings, errorMessage: null });
        wouldUpdate++;
      } else {
        // not found
        if (mode === "prices_only" || mode === "stock_only") {
          rows.push({ rowNumber: rowNum, sku, productName: null, wooProductId: null,
            matchStatus: "not_found", action: "would_skip", changes: [], warnings: [], errorMessage: null });
          wouldSkip++;
          continue;
        }
        const payload = buildCreatePayload(row, fm);
        const changeList = Object.keys(payload)
          .filter(k => k !== "meta_data")
          .map(k => ({ field: k, oldValue: null, newValue: serializeFieldValue(payload[k]) } as any));
        if (Array.isArray(payload.meta_data)) {
          for (const m of payload.meta_data as any[]) {
            changeList.push({ field: m.key, oldValue: null, newValue: serializeFieldValue(m.value) });
          }
        }
        rows.push({ rowNumber: rowNum, sku, productName: row["Name"] || null, wooProductId: null,
          matchStatus: "not_found", action: "would_create", changes: changeList, warnings, errorMessage: null });
        wouldCreate++;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    const result: DryRunResult = {
      mode,
      fileName: req.file.originalname,
      totalRows: records.length,
      wouldUpdate, wouldCreate, wouldSkip, errors,
      rows,
    };
    return res.json(result);
  });

  // ─── GET RUN RESULTS ──────────────────────────────────────────────────────
  app.get("/api/runs/:runId/results", (req, res) => {
    const runId = parseInt(req.params.runId);
    const run = storage.getRun(runId);
    if (!run) return res.status(404).json({ error: "Run not found" });
    const results = storage.getResultsByRun(runId);
    return res.json({ run, results });
  });

  // Export results as CSV
  app.get("/api/runs/:runId/export", (req, res) => {
    const runId = parseInt(req.params.runId);
    const run = storage.getRun(runId);
    if (!run) return res.status(404).json({ error: "Run not found" });
    const results = storage.getResultsByRun(runId);

    const header = "Row,SKU,Product Name,Match Status,Action,Updated Fields,Warnings,Errors,Woo Product ID\n";
    const rows = results.map((r) => {
      const fields = [
        r.rowNumber,
        r.sku || "",
        (r.productName || "").replace(/,/g, ";"),
        r.matchStatus || "",
        r.action || "",
        r.updatedFields ? JSON.parse(r.updatedFields).join(" | ") : "",
        r.warnings ? JSON.parse(r.warnings).join(" | ") : "",
        r.errorMessage || "",
        r.wooProductId || "",
      ];
      return fields.map((f) => `"${String(f).replace(/"/g, '""')}"`).join(",");
    });

    const csv = header + rows.join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="import-results-${runId}.csv"`);
    return res.send(csv);
  });
}
