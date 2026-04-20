/**
 * ColumnMapper — maps CSV source columns to WooCommerce target fields.
 * Displays a table of source columns with auto-detected suggestions and
 * a dropdown to choose the target WooCommerce field (or "(ignore)").
 */
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Info,
  Wand2,
  SkipForward,
  Columns,
} from "lucide-react";

// All WooCommerce fields the import pipeline recognises
export const WOO_TARGET_FIELDS = [
  { value: "SKU", label: "SKU", required: true },
  { value: "Name", label: "Name" },
  { value: "Description", label: "Long Description" },
  { value: "Short description", label: "Short Description" },
  { value: "Regular price", label: "Regular Price" },
  { value: "Sale price", label: "Sale Price" },
  { value: "Msrp", label: "MSRP" },
  { value: "Cost", label: "Cost / COG" },
  { value: "Stock", label: "Stock Quantity" },
  { value: "In stock?", label: "In Stock?" },
  { value: "Status", label: "Status (publish/draft)" },
  { value: "Tags", label: "Tags" },
  { value: "Categories", label: "Category" },
  { value: "Subcategory", label: "Subcategory" },
  { value: "Sub-Subcategory", label: "Sub-Subcategory" },
  { value: "Brands", label: "Brand" },
  { value: "Key Features", label: "Key Features" },
  { value: "Images", label: "Image URL(s)" },
  { value: "Height (in)", label: "Height (in)" },
  { value: "Length (in)", label: "Length (in)" },
  { value: "Width (in)", label: "Width (in)" },
  { value: "Weight (lbs)", label: "Weight (lbs)" },
  { value: "(ignore)", label: "— Ignore this column —" },
];

// Auto-detect suggestions based on common supplier column name patterns
function autoDetect(col: string): string | null {
  const c = col.toLowerCase().replace(/[^a-z0-9]/g, "");
  
  if (c === "sku" || c === "partnumber" || c === "partno" || c === "part" || c === "itemno" || c === "itemnumber" || c === "productcode" || c === "code") return "SKU";
  if (c === "name" || c === "title" || c === "productname" || c === "itemname" || c === "description" && col.length < 15) return "Name";
  if (c.includes("longdesc") || c.includes("fulldesc") || c.includes("longdescription") || (c.includes("description") && c.includes("150")) || c === "productdescription") return "Description";
  if (c.includes("shortdesc") || c === "excerpt" || c === "tagline") return "Short description";
  if (c.includes("description") && !c.includes("long") && !c.includes("short") && !c.includes("150")) return "Description";
  if (c === "suggestedretail" || c === "retailprice" || c === "listprice" || c === "price" || c === "regularprice" || c === "msrp" && col.includes("Retail")) return "Regular price";
  if (c === "msrp" || c === "vendormsrp" || c === "manufacturersuggested") return "Msrp";
  if (c === "saleprice" || c === "discountprice" || c === "specialprice") return "Sale price";
  if (c === "cost" || c === "jobber" || c === "costprice" || c === "wholesale") return "Cost";
  if (c === "qtyavail" || c === "qty" || c === "quantity" || c === "stock" || c === "stockqty" || c === "inventory" || c === "qoh") return "Stock";
  if (c === "instock" || c === "available" || c === "availability" || c === "stockstatus") return "In stock?";
  if (c === "status" || c === "productstatus") return "Status";
  if (c === "tags" || c === "keywords" || c === "tag") return "Tags";
  // Categories — map level 1 to main Categories, level 2 to Subcategory, level 3 to Sub-Subcategory
  if (c === "categories" || c === "category" || c === "categorylevel1" || c === "cat1" || c === "category1") return "Categories";
  if (c === "subcategory" || c === "categorylevel2" || c === "cat2" || c === "category2" || c === "subcategories") return "Subcategory";
  if (c === "subsubcategory" || c === "categorylevel3" || c === "cat3" || c === "category3") return "Sub-Subcategory";
  if (c === "brand" || c === "manufacturer" || c === "make" || c === "vendor") return "Brands";
  if (c.includes("keyfeature") || c.includes("feature") || c === "highlights" || c === "bulletpoints") return "Key Features";
  if (c.includes("image") || c.includes("photo") || c.includes("img") || c === "picture") return "Images";
  if (c === "upc" || c === "aaiacode" || c === "barcode" || c === "gtin") return "(ignore)";
  // Dimensions — map to the new dimension fields
  if (c === "height" || c === "heightin" || c === "height_in") return "Height (in)";
  if (c === "length" || c === "lengthin" || c === "length_in") return "Length (in)";
  if (c === "width" || c === "widthin" || c === "width_in") return "Width (in)";
  if (c === "weight" || c === "weightlbs" || c === "weight_lbs") return "Weight (lbs)";
  if (c.includes("restrict") || c === "airrestricted" || c === "truckfrtonly" || c === "motorstatenotes") return "(ignore)";
  if (c.includes("acquired") || c.includes("emission") || c === "shipaloneonly" || c === "shipalone") return "(ignore)";
  if (c.includes("canada") || c === "manufacturerpart") return "(ignore)";
  
  return null;
}

export interface ColumnMapState {
  [sourceColumn: string]: string; // source col → target WooCommerce field ("" means keep original)
}

interface ColumnMapperProps {
  sourceColumns: string[];
  preview: Record<string, any>[];
  onComplete: (columnMap: ColumnMapState) => void;
  onBack: () => void;
}

export function ColumnMapper({ sourceColumns, preview, onComplete, onBack }: ColumnMapperProps) {
  const [mapping, setMapping] = useState<ColumnMapState>({});
  const [autoApplied, setAutoApplied] = useState(false);

  // Auto-detect on mount
  useEffect(() => {
    if (autoApplied) return;
    const initial: ColumnMapState = {};
    for (const col of sourceColumns) {
      const detected = autoDetect(col);
      if (detected) {
        initial[col] = detected;
      }
    }
    setMapping(initial);
    setAutoApplied(true);
  }, [sourceColumns, autoApplied]);

  const hasSku = Object.values(mapping).includes("SKU");
  const ignoredCount = Object.values(mapping).filter(v => v === "(ignore)").length;
  const mappedCount = Object.values(mapping).filter(v => v && v !== "(ignore)").length;

  // Count duplicate targets (besides "(ignore)")
  const targetCounts: Record<string, number> = {};
  for (const v of Object.values(mapping)) {
    if (v && v !== "(ignore)") targetCounts[v] = (targetCounts[v] || 0) + 1;
  }
  const hasDuplicates = Object.values(targetCounts).some(n => n > 1);

  function setField(col: string, target: string) {
    setMapping(prev => ({ ...prev, [col]: target }));
  }

  function clearField(col: string) {
    setMapping(prev => {
      const next = { ...prev };
      delete next[col];
      return next;
    });
  }

  function handleContinue() {
    // Build the final map: only include columns where target !== original name
    // (or where target is explicitly "(ignore)")
    const finalMap: ColumnMapState = {};
    for (const [col, target] of Object.entries(mapping)) {
      if (target) {
        finalMap[col] = target;
      }
    }
    onComplete(finalMap);
  }

  function resetToAuto() {
    const fresh: ColumnMapState = {};
    for (const col of sourceColumns) {
      const detected = autoDetect(col);
      if (detected) fresh[col] = detected;
    }
    setMapping(fresh);
  }

  // Sample values for preview
  function getSampleValue(col: string): string {
    for (const row of preview) {
      const v = row[col];
      if (v !== null && v !== undefined && String(v).trim()) {
        const s = String(v).trim();
        return s.length > 60 ? s.slice(0, 57) + "…" : s;
      }
    }
    return "";
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Columns className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">Map Your Columns</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Your CSV uses custom column names. Map each one to the corresponding WooCommerce field.
          Columns auto-detected as irrelevant are pre-set to Ignore.
        </p>
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap gap-3">
        <Badge variant={hasSku ? "default" : "destructive"} className="gap-1">
          {hasSku ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          SKU {hasSku ? "mapped" : "not mapped"}
        </Badge>
        <Badge variant="secondary">{mappedCount} fields mapped</Badge>
        <Badge variant="outline">{ignoredCount} ignored</Badge>
        {hasDuplicates && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" /> Duplicate targets
          </Badge>
        )}
      </div>

      {!hasSku && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            You must map one column to <strong>SKU</strong> — it's the only way the import can
            match products. Look for your part number or item code column.
          </AlertDescription>
        </Alert>
      )}

      {hasDuplicates && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Two or more source columns map to the same WooCommerce field. The last one in the
            table will win. Consider setting the others to "Ignore".
          </AlertDescription>
        </Alert>
      )}

      {/* Mapping table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Column Mappings ({sourceColumns.length})</CardTitle>
            <Button variant="ghost" size="sm" onClick={resetToAuto} className="gap-1 h-7 text-xs">
              <Wand2 className="h-3 w-3" />
              Reset auto-detect
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {sourceColumns.map((col) => {
              const target = mapping[col] || "";
              const sample = getSampleValue(col);
              const isDuplicate = target && target !== "(ignore)" && (targetCounts[target] || 0) > 1;
              const isIgnored = target === "(ignore)";
              const isMapped = target && !isIgnored;

              return (
                <div
                  key={col}
                  className={`flex items-start gap-3 px-4 py-3 ${isIgnored ? "opacity-50" : ""}`}
                >
                  {/* Source column */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-mono font-medium ${isMapped ? "text-foreground" : isIgnored ? "text-muted-foreground line-through" : "text-muted-foreground"}`}>
                        {col}
                      </span>
                      {isDuplicate && (
                        <Badge variant="destructive" className="text-[10px] px-1 py-0">dup</Badge>
                      )}
                    </div>
                    {sample && !isIgnored && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{sample}</p>
                    )}
                  </div>

                  {/* Arrow */}
                  <div className="flex items-center pt-1.5">
                    <ArrowRight className={`h-4 w-4 ${isMapped ? "text-primary" : "text-muted-foreground/30"}`} />
                  </div>

                  {/* Target select */}
                  <div className="w-52 flex-shrink-0">
                    <Select
                      value={target || "__none__"}
                      onValueChange={(val) => {
                        if (val === "__none__") clearField(col);
                        else setField(col, val);
                      }}
                    >
                      <SelectTrigger
                        className={`h-8 text-xs ${
                          target === "SKU" ? "border-primary ring-1 ring-primary" :
                          isMapped ? "border-green-500/50" :
                          isIgnored ? "border-muted" : ""
                        }`}
                        data-testid={`select-col-${col}`}
                      >
                        <SelectValue placeholder="Keep as-is / skip" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">
                          <span className="text-muted-foreground italic">Keep original name</span>
                        </SelectItem>
                        {WOO_TARGET_FIELDS.map((f) => (
                          <SelectItem key={f.value} value={f.value}>
                            {f.required ? `⭐ ${f.label}` : f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button
          onClick={handleContinue}
          disabled={!hasSku}
          className="gap-2"
          data-testid="btn-mapper-continue"
        >
          Continue to Preview
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
