/**
 * Shopify CSV → WooCommerce CSV Converter
 *
 * Handles the exact column structure of G8Only's Shopify exports.
 * Grouped by Handle → one WooCommerce parent row per product,
 * plus one variation row per true variant (skips "Default Title" singles).
 */

import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShopifyRow {
  Handle: string;
  Title: string;
  "Body (HTML)": string;
  Vendor: string;
  "Product Category": string;
  Type: string;
  Tags: string;
  Published: string;
  "Option1 Name": string;
  "Option1 Value": string;
  "Option2 Name": string;
  "Option2 Value": string;
  "Option3 Name": string;
  "Option3 Value": string;
  "Variant SKU": string;
  "Variant Grams": string;
  "Variant Price": string;
  "Variant Compare At Price": string;
  "Image Src": string;
  "Image Position": string;
  "Image Alt Text": string;
  "SEO Title": string;
  "SEO Description": string;
  "Variant Image": string;
  "Variant Weight Unit": string;
  "Cost per item": string;
  "Variant Barcode": string;
  "Variant Inventory Policy": string;
  Status: string;
  [key: string]: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Title Case — capitalise first letter of every word.
 * Preserves slash-separated parts (e.g. "6.0L/6.2L").
 */
function toTitleCase(str: string): string {
  if (!str) return str;
  return str
    .split(" ")
    .map((word) => {
      if (!word) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * Force a vendor/brand string to FULL CAPS.
 * Also replaces occurrences of the vendor name inside a title string.
 */
function vendorCaps(vendor: string): string {
  return (vendor || "").toUpperCase();
}

/**
 * Replace the vendor name anywhere it appears in a title with its CAPS version.
 * Case-insensitive match.
 */
function injectVendorCaps(title: string, vendor: string): string {
  if (!vendor) return title;
  const escaped = vendor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return title.replace(new RegExp(escaped, "gi"), vendorCaps(vendor));
}

/**
 * Build the WooCommerce product name:
 * "VENDOR - Title Case Title"
 */
function buildProductName(title: string, vendor: string): string {
  const titleCased = toTitleCase(title);
  const vendorUpper = vendorCaps(vendor);
  const withVendorFixed = injectVendorCaps(titleCased, vendor);
  if (vendorUpper && !withVendorFixed.toUpperCase().startsWith(vendorUpper)) {
    return `${vendorUpper} - ${withVendorFixed}`;
  }
  return withVendorFixed;
}

/**
 * Extract clean, human-readable tags from a Shopify Tags cell.
 * Strips:  Bucket:*, fits_*, EPA:*, ClearanceItem:*, LTL:*, MPN:*, Non-CARB:*,
 *          Prop65:*, SpecialOrder:*, TURN14_ID:*, Filtered:*, Drivetrain>*,
 *          Engine Components>*, Fabrication>*, Suspension>*, etc. (any "Cat>Sub" paths)
 * Keeps:   plain tags like "dod", "dod delete", short descriptive strings
 */
function extractCleanTags(rawTags: string): string {
  if (!rawTags) return "";
  const skipPrefixes = [
    "bucket:",
    "fits_",
    "epa:",
    "clearanceitem:",
    "ltl:",
    "mpn:",
    "non-carb:",
    "prop65:",
    "specialorder:",
    "turn14_id:",
    "filtered:",
  ];
  const tags = rawTags
    .split(",")
    .map((t) => t.trim().replace(/^'+|'+$/g, "").trim()) // strip leading apostrophes
    .filter((t) => {
      if (!t) return false;
      const lower = t.toLowerCase();
      // skip internal keys
      if (skipPrefixes.some((p) => lower.startsWith(p))) return false;
      // skip category paths like "Engine Components>Gasket Kits"
      if (t.includes(">")) return false;
      return true;
    })
    .map((t) => t.trim())
    .filter(Boolean);

  // deduplicate
  return [...new Set(tags)].join(", ");
}

/**
 * Map Shopify Status → WooCommerce status
 */
function mapStatus(shopifyStatus: string): string {
  switch ((shopifyStatus || "").toLowerCase()) {
    case "active":
      return "publish";
    case "draft":
      return "draft";
    case "archived":
      return "draft";
    default:
      return "draft";
  }
}

/**
 * Convert grams → lbs (WooCommerce default weight unit for this store)
 * Returns empty string if not a valid number.
 */
function gramsToLbs(grams: string): string {
  const g = parseFloat(grams);
  if (isNaN(g) || g === 0) return "";
  return (g / 453.592).toFixed(3);
}

/**
 * Is this a "Default Title" / single-variant product?
 */
function isDefaultVariant(row: ShopifyRow): boolean {
  return (
    (row["Option1 Name"] || "").toLowerCase() === "title" &&
    (row["Option1 Value"] || "").toLowerCase() === "default title"
  );
}

// ---------------------------------------------------------------------------
// Main converter
// ---------------------------------------------------------------------------

export interface ConvertResult {
  csv: string;
  productCount: number;
  variantCount: number;
  warnings: string[];
}

export function convertShopifyToWooCommerce(shopifyCsv: string): ConvertResult {
  const warnings: string[] = [];

  // Parse Shopify CSV
  const rows: ShopifyRow[] = parse(shopifyCsv, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });

  // Group rows by Handle
  const groups = new Map<string, ShopifyRow[]>();
  for (const row of rows) {
    const handle = row.Handle;
    if (!handle) continue;
    if (!groups.has(handle)) groups.set(handle, []);
    groups.get(handle)!.push(row);
  }

  // WooCommerce output rows
  const wooRows: Record<string, string>[] = [];
  let productCount = 0;
  let variantCount = 0;

  for (const [handle, shopifyRows] of groups) {
    // The "master" row is the first row that has a Title
    const master = shopifyRows.find((r) => r.Title) || shopifyRows[0];
    if (!master) continue;

    // Collect ALL images across all rows for this handle, sorted by position
    const imageRows = shopifyRows
      .filter((r) => r["Image Src"])
      .sort((a, b) => {
        const posA = parseInt(a["Image Position"] || "999", 10);
        const posB = parseInt(b["Image Position"] || "999", 10);
        return posA - posB;
      });
    const imageUrls = imageRows.map((r) => r["Image Src"]).filter(Boolean);

    // Collect variant rows (rows that have a SKU or option values)
    // A row is a real variant row if it has a Variant SKU or Option values
    const variantRows = shopifyRows.filter(
      (r) =>
        r["Variant SKU"] ||
        (r["Option1 Value"] && r["Option1 Value"].toLowerCase() !== "default title")
    );

    const vendor = master.Vendor || "";
    const vendorUpper = vendorCaps(vendor);
    const rawTitle = master.Title || "";
    const productName = buildProductName(rawTitle, vendor);
    const cleanTags = extractCleanTags(master.Tags);
    const status = mapStatus(master.Status);
    const description = master["Body (HTML)"] || "";
    const category = master.Type || "";
    const images = imageUrls.join("|");

    // Check if truly variable (more than one real variant, or option name isn't "Title")
    const isVariable =
      variantRows.length > 1 ||
      (variantRows.length === 1 && !isDefaultVariant(variantRows[0] || master));

    if (isVariable) {
      // ── Variable product parent row ────────────────────────────────────────
      productCount++;

      // Collect attribute names
      const attr1Name = master["Option1 Name"] || "";
      const attr2Name = master["Option2 Name"] || "";
      const attr3Name = master["Option3 Name"] || "";

      // Collect all unique values per attribute
      const attr1Values = [
        ...new Set(variantRows.map((r) => r["Option1 Value"]).filter(Boolean)),
      ].join("|");
      const attr2Values = [
        ...new Set(variantRows.map((r) => r["Option2 Value"]).filter(Boolean)),
      ].join("|");
      const attr3Values = [
        ...new Set(variantRows.map((r) => r["Option3 Value"]).filter(Boolean)),
      ].join("|");

      // Price range from variants — use min price for parent
      const prices = variantRows
        .map((r) => parseFloat(r["Variant Price"]))
        .filter((p) => !isNaN(p));
      const minPrice = prices.length ? Math.min(...prices).toFixed(2) : "";

      wooRows.push({
        Type: "variable",
        SKU: "",
        Name: productName,
        "Published (1=publish, 0=private)": status === "publish" ? "1" : "0",
        "Short description": "",
        Description: description,
        "Tax status": "taxable",
        "In stock?": "1",
        Brand: vendorUpper,
        Categories: category,
        Tags: cleanTags,
        Images: images,
        "Regular price": minPrice,
        "Sale price": "",
        Weight: "",
        "Attribute 1 name": attr1Name,
        "Attribute 1 value(s)": attr1Values,
        "Attribute 1 visible": "1",
        "Attribute 1 variation": "1",
        "Attribute 2 name": attr2Name,
        "Attribute 2 value(s)": attr2Values,
        "Attribute 2 visible": attr2Name ? "1" : "",
        "Attribute 2 variation": attr2Name ? "1" : "",
        "Attribute 3 name": attr3Name,
        "Attribute 3 value(s)": attr3Values,
        "Attribute 3 visible": attr3Name ? "1" : "",
        "Attribute 3 variation": attr3Name ? "1" : "",
      });

      // ── Variation rows ─────────────────────────────────────────────────────
      for (const vRow of variantRows) {
        variantCount++;
        const varSku = vRow["Variant SKU"] || "";
        const varPrice = vRow["Variant Price"] || "";
        const varCompare = vRow["Variant Compare At Price"] || "";
        const varWeight = gramsToLbs(vRow["Variant Grams"]);
        const varBarcode = (vRow["Variant Barcode"] || "").replace(/^'+/, "");
        const varCost = vRow["Cost per item"] || "";
        const varImage = vRow["Variant Image"] || "";
        const varStock = vRow["Variant Inventory Policy"] === "deny" ? "0" : "";

        const opt1Val = vRow["Option1 Value"] || "";
        const opt2Val = vRow["Option2 Value"] || "";
        const opt3Val = vRow["Option3 Value"] || "";

        wooRows.push({
          Type: "variation",
          SKU: varSku,
          Name: productName,
          "Published (1=publish, 0=private)": "1",
          "Short description": "",
          Description: "",
          "Tax status": "taxable",
          "In stock?": "1",
          Brand: vendorUpper,
          Categories: "",
          Tags: "",
          Images: varImage || "",
          "Regular price": varPrice,
          "Sale price": varCompare ? varPrice : "",
          Weight: varWeight,
          "Attribute 1 name": attr1Name,
          "Attribute 1 value(s)": opt1Val,
          "Attribute 1 visible": "1",
          "Attribute 1 variation": "1",
          "Attribute 2 name": attr2Name,
          "Attribute 2 value(s)": opt2Val,
          "Attribute 2 visible": attr2Name ? "1" : "",
          "Attribute 2 variation": attr2Name ? "1" : "",
          "Attribute 3 name": attr3Name,
          "Attribute 3 value(s)": opt3Val,
          "Attribute 3 visible": attr3Name ? "1" : "",
          "Attribute 3 variation": attr3Name ? "1" : "",
          "Meta: _sku": varSku,
          "Meta: _wc_cog_cost": varCost,
          "Meta: _barcode": varBarcode,
        });
      }
    } else {
      // ── Simple product ─────────────────────────────────────────────────────
      productCount++;
      const vRow = variantRows[0] || master;
      const varSku = vRow["Variant SKU"] || master["Variant SKU"] || "";
      const varPrice = vRow["Variant Price"] || master["Variant Price"] || "";
      const varCompare =
        vRow["Variant Compare At Price"] || master["Variant Compare At Price"] || "";
      const varWeight = gramsToLbs(
        vRow["Variant Grams"] || master["Variant Grams"] || ""
      );
      const varBarcode = (
        vRow["Variant Barcode"] || master["Variant Barcode"] || ""
      ).replace(/^'+/, "");
      const varCost = vRow["Cost per item"] || master["Cost per item"] || "";

      if (!varSku) {
        warnings.push(
          `Product "${rawTitle}" (handle: ${handle}) has no SKU — included without SKU`
        );
      }

      wooRows.push({
        Type: "simple",
        SKU: varSku,
        Name: productName,
        "Published (1=publish, 0=private)": status === "publish" ? "1" : "0",
        "Short description": "",
        Description: description,
        "Tax status": "taxable",
        "In stock?": "1",
        Brand: vendorUpper,
        Categories: category,
        Tags: cleanTags,
        Images: images,
        "Regular price": varPrice,
        "Sale price": varCompare || "",
        Weight: varWeight,
        "Attribute 1 name": "",
        "Attribute 1 value(s)": "",
        "Attribute 1 visible": "",
        "Attribute 1 variation": "",
        "Attribute 2 name": "",
        "Attribute 2 value(s)": "",
        "Attribute 2 visible": "",
        "Attribute 2 variation": "",
        "Attribute 3 name": "",
        "Attribute 3 value(s)": "",
        "Attribute 3 visible": "",
        "Attribute 3 variation": "",
        "Meta: _wc_cog_cost": varCost,
        "Meta: _barcode": varBarcode,
      });
    }
  }

  // Build output CSV
  const csv = stringify(wooRows, { header: true });

  return { csv, productCount, variantCount, warnings };
}
