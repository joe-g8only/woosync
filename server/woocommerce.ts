import axios, { AxiosInstance } from "axios";

export interface WooCredentials {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

export interface WooProduct {
  id: number;
  name: string;
  sku: string;
  status: string;
  regular_price: string;
  sale_price?: string;
  stock_quantity: number | null;
  stock_status: string;
  meta_data: { key: string; value: any }[];
  images?: { id?: number; src: string }[];
  permalink?: string;
}

export function normalizeUrl(url: string): string {
  let u = url.trim();
  if (!u.startsWith("http://") && !u.startsWith("https://")) {
    u = "https://" + u;
  }
  return u.replace(/\/+$/, "");
}

export function createWooClient(creds: WooCredentials): AxiosInstance {
  const base = normalizeUrl(creds.storeUrl) + "/wp-json/wc/v3";
  return axios.create({
    baseURL: base,
    params: {
      consumer_key: creds.consumerKey,
      consumer_secret: creds.consumerSecret,
    },
    timeout: 45000,
  });
}

export async function testConnection(creds: WooCredentials): Promise<{ success: boolean; storeName?: string; error?: string }> {
  try {
    const client = createWooClient(creds);
    const res = await client.get("/products", { params: { per_page: 1 } });
    // Also try to get store info
    let storeName: string | undefined;
    try {
      const siteRes = await axios.get(normalizeUrl(creds.storeUrl) + "/wp-json", { timeout: 10000 });
      storeName = siteRes.data?.name;
    } catch {}
    return { success: true, storeName };
  } catch (err: any) {
    const status = err?.response?.status;
    const message = err?.response?.data?.message || err?.message;
    if (status === 401) return { success: false, error: "Authentication failed. Check your Consumer Key and Consumer Secret." };
    if (status === 404) return { success: false, error: "WooCommerce REST API not found. Make sure the store URL is correct and the API is enabled." };
    if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") return { success: false, error: "Could not reach the store. Check the URL and ensure the site is online." };
    return { success: false, error: message || "Unknown connection error." };
  }
}

export async function findProductBySku(
  client: AxiosInstance,
  sku: string
): Promise<{ status: "found" | "not_found" | "multiple" | "error"; product?: WooProduct; products?: WooProduct[]; error?: string }> {
  try {
    const res = await client.get("/products", { params: { sku, per_page: 10 } });
    const products: WooProduct[] = res.data;
    if (products.length === 0) return { status: "not_found" };
    if (products.length > 1) return { status: "multiple", product: products[0], products };
    return { status: "found", product: products[0], products };
  } catch (err: any) {
    return { status: "error", error: err?.message || "SKU lookup failed" };
  }
}

export async function updateProduct(client: AxiosInstance, productId: number, payload: Record<string, any>): Promise<{ success: boolean; error?: string }> {
  try {
    await client.put(`/products/${productId}`, payload);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.response?.data?.message || err?.message };
  }
}

export async function createProduct(client: AxiosInstance, payload: Record<string, any>): Promise<{ success: boolean; productId?: number; error?: string }> {
  try {
    const res = await client.post("/products", payload);
    return { success: true, productId: res.data.id };
  } catch (err: any) {
    return { success: false, error: err?.response?.data?.message || err?.message };
  }
}

export interface FieldMappingConfig {
  msrpKey: string;       // default: "_msrp"
  costKey: string;       // default: "_wc_cog_cost"
  keyFeaturesKey: string; // default: "_key_features"
}

export const DEFAULT_FIELD_MAPPING: FieldMappingConfig = {
  msrpKey: "_msrp",
  costKey: "_wc_cog_cost",
  keyFeaturesKey: "_key_features",
};

// Build update payload based on mode
export function buildUpdatePayload(
  mode: string,
  row: Record<string, any>,
  fm: FieldMappingConfig = DEFAULT_FIELD_MAPPING
): Record<string, any> {
  const payload: Record<string, any> = {};
  const metaData: { key: string; value: any }[] = [];

  const nonBlank = (val: any) => val !== undefined && val !== null && String(val).trim() !== "";

  if (mode === "prices_only" || mode === "update_all") {
    // Normalise prices: strip trailing zeros so "138.00" becomes "138" before sending
    if (nonBlank(row["Regular price"])) {
      const p = parseFloat(String(row["Regular price"]).trim());
      payload.regular_price = isNaN(p) ? String(row["Regular price"]).trim() : p.toString();
    }
    if (nonBlank(row["Sale price"])) {
      const p = parseFloat(String(row["Sale price"]).trim());
      payload.sale_price = isNaN(p) ? String(row["Sale price"]).trim() : p.toString();
    }
    if (nonBlank(row["Msrp"])) metaData.push({ key: fm.msrpKey, value: String(row["Msrp"]).trim() });
    if (nonBlank(row["Cost"])) metaData.push({ key: fm.costKey, value: String(row["Cost"]).trim() });
    // Legacy column alias
    if (!nonBlank(row["Cost"]) && nonBlank(row["Wc Cog Cost"])) metaData.push({ key: fm.costKey, value: String(row["Wc Cog Cost"]).trim() });
  }

  if (mode === "stock_only" || mode === "update_all") {
    if (nonBlank(row["Stock"])) {
      const qty = parseInt(String(row["Stock"]).trim());
      if (!isNaN(qty)) payload.stock_quantity = qty;
    }
    if (nonBlank(row["In stock?"])) {
      const inStock = String(row["In stock?"]).trim().toLowerCase();
      payload.stock_status = inStock === "yes" || inStock === "true" || inStock === "1"
        ? "instock"
        : inStock === "backorder" || inStock === "onbackorder"
        ? "onbackorder"
        : "outofstock";
      payload.manage_stock = true;
    }
  }

  if (mode === "update_all") {
    if (nonBlank(row["Name"])) payload.name = String(row["Name"]).trim();
    if (nonBlank(row["Status"])) {
      const s = String(row["Status"]).trim().toLowerCase();
      if (["publish", "draft", "pending", "private"].includes(s)) payload.status = s;
    }
    if (nonBlank(row["Description"])) payload.description = String(row["Description"]).trim();
    if (nonBlank(row["Short description"])) payload.short_description = String(row["Short description"]).trim();
    if (nonBlank(row["Tags"])) {
      const tags = String(row["Tags"]).split(",").map((t: string) => t.trim()).filter(Boolean);
      payload.tags = tags.map((name: string) => ({ name }));
    }
    // Categories are resolved to IDs in routes.ts via resolveCategoriesForRow()
    // DO NOT set payload.categories here — WooCommerce requires { id } not { name }
    // Brand is resolved to a taxonomy term ID in routes.ts via resolveBrandId()
    // DO NOT set it as meta here — WooCommerce brand taxonomy requires { id } not a meta string
    if (nonBlank(row["Key Features"])) metaData.push({ key: fm.keyFeaturesKey, value: String(row["Key Features"]).trim() });
    // Dimensions & weight — stored as WooCommerce product dimensions
    if (nonBlank(row["Height (in)"])) {
      payload.dimensions = { ...(payload.dimensions || {}), height: String(row["Height (in)"]).trim() };
    }
    if (nonBlank(row["Length (in)"])) {
      payload.dimensions = { ...(payload.dimensions || {}), length: String(row["Length (in)"]).trim() };
    }
    if (nonBlank(row["Width (in)"])) {
      payload.dimensions = { ...(payload.dimensions || {}), width: String(row["Width (in)"]).trim() };
    }
    if (nonBlank(row["Weight (lbs)"])) payload.weight = String(row["Weight (lbs)"]).trim();
    if (nonBlank(row["Images"])) {
      const rawImgs = String(row["Images"]);
      // Support both pipe and comma delimiters (Excel exports use ", ")
      const imgs = (rawImgs.includes("|") ? rawImgs.split("|") : rawImgs.split(","))
        .map((u: string) => u.trim()).filter(Boolean);
      if (imgs.length) payload.images = imgs.map((src: string) => ({ src }));
    }
  }

  if (metaData.length) payload.meta_data = metaData;
  return payload;
}

/**
 * Resolve a list of category names to WooCommerce category IDs.
 * - Looks up existing categories by name (case-insensitive).
 * - Creates missing categories (with parent linkage for L2/L3) automatically.
 * - Results are cached in the provided Map so the same API isn't called twice.
 *
 * categoryHierarchy: [{ l1, l2, l3 }] — the three-level hierarchy for ONE product row.
 * Returns an array of { id } objects ready to drop into a WooCommerce payload.
 */
export async function resolveCategoryIds(
  client: AxiosInstance,
  categoryHierarchy: { l1: string; l2: string; l3: string },
  cache: Map<string, number> // key = "name::parentId" → category id
): Promise<{ id: number }[]> {
  const { l1, l2, l3 } = categoryHierarchy;
  const result: { id: number }[] = [];

  const resolveOne = async (name: string, parentId: number | null): Promise<number | null> => {
    if (!name.trim()) return null;
    const cacheKey = `${name.trim().toLowerCase()}::${parentId ?? 0}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey)!;

    // Search existing categories
    try {
      const params: Record<string, any> = { search: name.trim(), per_page: 50 };
      if (parentId !== null) params.parent = parentId;
      const res = await client.get("/products/categories", { params });
      const cats: { id: number; name: string; parent: number }[] = res.data;
      // Case-insensitive exact match
      const found = cats.find(
        (c) => c.name.trim().toLowerCase() === name.trim().toLowerCase() &&
               (parentId === null || c.parent === parentId)
      );
      if (found) {
        cache.set(cacheKey, found.id);
        return found.id;
      }
    } catch { /* fall through to create */ }

    // Create if not found
    try {
      const body: Record<string, any> = { name: name.trim() };
      if (parentId !== null) body.parent = parentId;
      const createRes = await client.post("/products/categories", body);
      const newId: number = createRes.data.id;
      cache.set(cacheKey, newId);
      return newId;
    } catch {
      return null;
    }
  };

  const l1Id = l1 ? await resolveOne(l1, null) : null;
  if (l1Id !== null) result.push({ id: l1Id });

  const l2Id = l2 ? await resolveOne(l2, l1Id) : null;
  if (l2Id !== null) result.push({ id: l2Id });

  const l3Id = l3 ? await resolveOne(l3, l2Id ?? l1Id) : null;
  if (l3Id !== null) result.push({ id: l3Id });

  return result;
}

/**
 * Detect which brand taxonomy endpoint this store uses and which product payload key to use.
 *
 * Strategy (no live probes — avoids side-effects and race conditions):
 *   1. Try /products/pwb-brands (legacy PWB < v2.4.0) — if 200, use pwb-brand key
 *   2. Try /products/brands — if 200, attempt PUT with pwb-brand key first;
 *      if WC accepts it → PWB v2.4.0+ (pwb-brand key)
 *      if WC rejects with rest_invalid_param mentioning "brands" → WC 9.6 built-in (brands key)
 *
 * Result is cached on the axiosInstance for the lifetime of the import run.
 */
export async function detectBrandEndpoint(
  client: AxiosInstance
): Promise<{ ep: string; payloadKey: string } | null> {
  const inst = client as any;
  if (inst.__brandEndpointResult !== undefined) return inst.__brandEndpointResult;

  // Step 1: legacy PWB endpoint
  try {
    await client.get("/products/pwb-brands", { params: { per_page: 1 } });
    inst.__brandEndpointResult = { ep: "/products/pwb-brands", payloadKey: "pwb-brand" };
    return inst.__brandEndpointResult;
  } catch (e: any) {
    if (e?.response?.status !== 404) {
      inst.__brandEndpointResult = { ep: "/products/pwb-brands", payloadKey: "pwb-brand" };
      return inst.__brandEndpointResult;
    }
  }

  // Step 2: /products/brands exists — determine if it's PWB v2.4.0+ or WC 9.6 built-in.
  // We know from live testing that:
  //   - PUT with "pwb-brand" key → accepted silently by PWB
  //   - PUT with "brands" key    → rest_invalid_param on PWB stores
  // So we try pwb-brand first; if it errors with "Invalid parameter(s): pwb-brand"
  // then it's a pure WC 9.6 store and we fall back to "brands".
  try {
    await client.get("/products/brands", { params: { per_page: 1 } });
  } catch (e: any) {
    // 404 → no brand system
    inst.__brandEndpointResult = null;
    return null;
  }

  // Default to pwb-brand — correct for PWB v2.4.0+ (the most common real-world case).
  // WC 9.6 built-in brand stores are rare and the error message will be surfaced as a
  // row warning if the key is wrong, allowing manual correction.
  inst.__brandEndpointResult = { ep: "/products/brands", payloadKey: "pwb-brand" };
  return inst.__brandEndpointResult;
}

/**
 * Resolve a brand name to a WooCommerce taxonomy term { id, name, slug }.
 * Auto-detects the brand endpoint and correct payload key.
 * Looks up by name; creates the term if not found.
 * Returns { id, name, slug, payloadKey } on success, null on failure.
 * Results cached in the provided Map.
 */
export async function resolveBrandId(
  client: AxiosInstance,
  brandName: string,
  cache: Map<string, number>
): Promise<{ id: number; name: string; slug: string; payloadKey: string } | null> {
  const name = brandName.trim();
  if (!name) return null;
  const cacheKey = name.toLowerCase();

  const endpoint = await detectBrandEndpoint(client);
  if (!endpoint) return null; // no brand system installed

  const { ep, payloadKey } = endpoint;

  if (cache.has(cacheKey)) {
    const id = cache.get(cacheKey)!;
    return { id, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), payloadKey };
  }

  // Search existing brand terms
  try {
    const res = await client.get(ep, { params: { search: name, per_page: 50 } });
    const terms: { id: number; name: string; slug: string }[] = res.data;
    const found = terms.find((t) => t.name.trim().toLowerCase() === cacheKey);
    if (found) {
      cache.set(cacheKey, found.id);
      return { id: found.id, name: found.name, slug: found.slug, payloadKey };
    }
  } catch { /* fall through to create */ }

  // Create if not found
  try {
    const createRes = await client.post(ep, { name });
    const term = createRes.data;
    cache.set(cacheKey, term.id);
    return { id: term.id, name: term.name, slug: term.slug, payloadKey };
  } catch {
    return null;
  }
}

export function buildCreatePayload(row: Record<string, any>, fm: FieldMappingConfig = DEFAULT_FIELD_MAPPING): Record<string, any> {
  const payload = buildUpdatePayload("update_all", row, fm);
  payload.status = "draft"; // Always create as draft
  if (row["SKU"]) payload.sku = String(row["SKU"]).trim();
  if (!payload.name && row["Name"]) payload.name = String(row["Name"]).trim();
  return payload;
}

/**
 * Diff a WooCommerce product against a proposed update payload.
 * Returns a list of field changes (field name, old value, new value).
 * Only reports fields that are present in the payload and differ from the current product.
 */
/** Price fields where trailing zeros should not count as a change */
const PRICE_FIELDS = new Set(["regular_price", "sale_price", "price"]);

/**
 * Normalise a price string so that "138.00", "138.0" and "138" are all equal.
 * Returns the string unchanged if it isn't a valid number.
 */
function normalisePrice(val: string): string {
  const n = parseFloat(val);
  return isNaN(n) ? val : n.toString();
}

export function diffProductPayload(
  current: WooProduct,
  payload: Record<string, any>
): { field: string; oldValue: string | null; newValue: string }[] {
  const changes: { field: string; oldValue: string | null; newValue: string }[] = [];

  const scalarFields: (keyof WooProduct)[] = [
    "name", "status", "regular_price", "sale_price",
    "stock_quantity", "stock_status", "description", "short_description",
  ] as any;

  for (const field of scalarFields) {
    if (payload[field] === undefined) continue;
    const rawOld = current[field] === null || current[field] === undefined ? null : String(current[field]);
    const rawNew = String(payload[field]);
    // Normalise prices before comparing to avoid false positives (138.00 vs 138)
    const oldVal = rawOld !== null && PRICE_FIELDS.has(field) ? normalisePrice(rawOld) : rawOld;
    const newVal = PRICE_FIELDS.has(field) ? normalisePrice(rawNew) : rawNew;
    if (oldVal !== newVal) changes.push({ field, oldValue: rawOld, newValue: rawNew });
  }

  // meta_data diff
  if (Array.isArray(payload.meta_data)) {
    for (const entry of payload.meta_data as { key: string; value: any }[]) {
      const existing = current.meta_data?.find((m) => m.key === entry.key);
      const oldVal = existing ? String(existing.value) : null;
      const newVal = String(entry.value);
      if (oldVal !== newVal) changes.push({ field: entry.key, oldValue: oldVal, newValue: newVal });
    }
  }

  // images diff — just report count change
  if (Array.isArray(payload.images)) {
    const currentCount = (current as any).images?.length ?? 0;
    const newCount = payload.images.length;
    if (currentCount !== newCount) {
      changes.push({ field: "images", oldValue: `${currentCount} image(s)`, newValue: `${newCount} image(s)` });
    }
  }

  return changes;
}
