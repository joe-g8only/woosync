import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, API_BASE } from "@/lib/queryClient";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { IMPORT_MODES } from "@shared/schema";
import type { ImportRun, ImportResult, FieldChange } from "@shared/schema";
import {
  CheckCircle2,
  XCircle,
  SkipForward,
  AlertTriangle,
  PlusCircle,
  Download,
  RotateCcw,
  RefreshCw,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ResultsData {
  run: ImportRun;
  results: ImportResult[];
}

const ACTION_CONFIG: Record<string, { label: string; icon: React.ComponentType<any>; cls: string }> = {
  updated: {
    label: "Updated",
    icon: CheckCircle2,
    cls: "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800",
  },
  updated_with_warnings: {
    label: "Updated",
    icon: CheckCircle2,
    cls: "text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800",
  },
  created: {
    label: "Created",
    icon: PlusCircle,
    cls: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800",
  },
  skipped: {
    label: "Skipped",
    icon: SkipForward,
    cls: "text-muted-foreground bg-muted/30 border-border",
  },
  error: {
    label: "Error",
    icon: XCircle,
    cls: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800",
  },
};

function StatCard({
  label,
  value,
  icon: Icon,
  cls,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<any>;
  cls: string;
}) {
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
    </div>
  );
}

/** Friendly display name for a WooCommerce field key */
function fieldLabel(key: string): string {
  const map: Record<string, string> = {
    name: "Name",
    regular_price: "Regular Price",
    sale_price: "Sale Price",
    price: "Price",
    sku: "SKU",
    stock_quantity: "Stock Qty",
    stock_status: "Stock Status",
    manage_stock: "Manage Stock",
    status: "Status",
    short_description: "Short Description",
    description: "Description",
    categories: "Categories",
    images: "Images",
    weight: "Weight",
    _msrp: "MSRP",
    _wc_cog_cost: "Cost",
    _key_features: "Key Features",
    product_brand: "Brand",
  };
  return map[key] ?? key;
}

function FieldChangesTable({ changes, warnings, errorMessage }: { changes: FieldChange[]; warnings: string[]; errorMessage?: string | null }) {
  const hasContent = changes.length > 0 || warnings.length > 0 || errorMessage;
  if (!hasContent) return <p className="text-xs text-muted-foreground py-2">No field-level details recorded.</p>;

  return (
    <div className="space-y-3">
      {errorMessage && (
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
          <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-1">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 p-2.5 rounded-md bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800 text-xs text-yellow-700 dark:text-yellow-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {changes.length > 0 && (
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-3 py-2 text-muted-foreground font-medium w-1/4">Field</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium w-[37.5%]">Before</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium w-[37.5%]">After</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c, i) => (
                <tr key={i} className="border-b border-border last:border-0 hover:bg-accent/10">
                  <td className="px-3 py-2 font-medium text-foreground">{fieldLabel(c.field)}</td>
                  <td className="px-3 py-2 font-mono">
                    {c.oldValue !== null ? (
                      <span className="line-through text-muted-foreground">{c.oldValue}</span>
                    ) : (
                      <span className="text-muted-foreground italic">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400 font-medium">
                      <ArrowRight className="w-3 h-3 shrink-0 text-muted-foreground" />
                      {c.newValue ?? <span className="italic text-muted-foreground">empty</span>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ResultRow({ r, index }: { r: ImportResult; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const actionCfg = ACTION_CONFIG[r.action || "skipped"] || ACTION_CONFIG.skipped;
  const ActionIcon = actionCfg.icon;
  const warnings: string[] = r.warnings ? JSON.parse(r.warnings) : [];
  const fieldChanges: FieldChange[] = r.fieldChanges ? JSON.parse(r.fieldChanges) : [];
  const hasDetails = fieldChanges.length > 0 || warnings.length > 0 || !!r.errorMessage;

  return (
    <>
      <tr
        className={`border-b border-border transition-colors ${hasDetails ? "cursor-pointer hover:bg-accent/20" : "hover:bg-accent/10"} ${expanded ? "bg-accent/10" : ""}`}
        onClick={() => hasDetails && setExpanded((v) => !v)}
        data-testid={`row-result-${r.id}`}
      >
        <td className="px-3 py-2.5 text-muted-foreground">{r.rowNumber}</td>
        <td className="px-3 py-2.5 font-mono font-medium text-foreground">
          {r.sku || <span className="text-muted-foreground italic">—</span>}
        </td>
        <td className="px-3 py-2.5 text-muted-foreground max-w-[160px] truncate" title={r.productName || ""}>
          {r.productName || <span className="italic">—</span>}
        </td>
        <td className="px-3 py-2.5">
          <span
            className={`px-1.5 py-0.5 rounded text-xs font-medium ${
              r.matchStatus === "found"
                ? "text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/30"
                : r.matchStatus === "not_found"
                ? "text-muted-foreground bg-muted/50"
                : r.matchStatus === "multiple"
                ? "text-yellow-700 dark:text-yellow-300 bg-yellow-100 dark:bg-yellow-900/30"
                : "text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30"
            }`}
          >
            {r.matchStatus?.replace("_", " ") || "—"}
          </span>
        </td>
        <td className="px-3 py-2.5">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs font-medium ${actionCfg.cls}`}>
            <ActionIcon className="w-3 h-3" />
            {actionCfg.label}
            {r.action === "updated_with_warnings" && <AlertTriangle className="w-3 h-3 text-yellow-500" />}
          </span>
        </td>
        <td className="px-3 py-2.5">
          {hasDetails ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {fieldChanges.length > 0 && <span className="text-indigo-600 dark:text-indigo-400 font-medium">{fieldChanges.length} field{fieldChanges.length !== 1 ? "s" : ""}</span>}
              {warnings.length > 0 && <span className="text-yellow-600 dark:text-yellow-400">{warnings.length} warning{warnings.length !== 1 ? "s" : ""}</span>}
              {r.errorMessage && <span className="text-red-600 dark:text-red-400 truncate max-w-[120px]" title={r.errorMessage}>{r.errorMessage}</span>}
              {expanded ? <ChevronDown className="w-3.5 h-3.5 ml-auto" /> : <ChevronRight className="w-3.5 h-3.5 ml-auto" />}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground italic">—</span>
          )}
        </td>
      </tr>
      {expanded && hasDetails && (
        <tr className="border-b border-border bg-muted/20" data-testid={`row-detail-${r.id}`}>
          <td colSpan={6} className="px-4 py-3">
            <FieldChangesTable changes={fieldChanges} warnings={warnings} errorMessage={r.errorMessage} />
          </td>
        </tr>
      )}
    </>
  );
}

export default function ResultsPage() {
  const { runId } = useParams<{ runId: string }>();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [filterAction, setFilterAction] = useState("all");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/runs", runId, "results"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${runId}/results`);
      return res.json() as Promise<ResultsData>;
    },
  });

  const modeLabel = data ? IMPORT_MODES.find((m) => m.value === data.run.mode)?.label : "";

  const filteredResults = (data?.results || []).filter((r) => {
    const matchesSearch =
      !search ||
      (r.sku || "").toLowerCase().includes(search.toLowerCase()) ||
      (r.productName || "").toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filterAction === "all" || r.action === filterAction;
    return matchesSearch && matchesFilter;
  });

  const handleExport = () => {
    window.open(`${API_BASE}/api/runs/${runId}/export`, "_blank");
  };

  if (isLoading) {
    return (
      <AppShell>
        <div className="max-w-4xl mx-auto px-6 py-10">
          <Skeleton className="h-8 w-64 mb-6" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-96 rounded-lg" />
        </div>
      </AppShell>
    );
  }

  if (!data) return null;

  const { run, results } = data;
  const warningCount = results.filter((r) => r.action === "updated_with_warnings").length;

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                <h1 className="text-xl font-semibold text-foreground">Import Complete</h1>
              </div>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{modeLabel}</span> · {run.fileName} ·{" "}
                {run.totalRows.toLocaleString()} rows processed
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleExport}
                data-testid="button-export-csv"
              >
                <Download className="w-3.5 h-3.5" />
                Export Report
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => navigate("/")}
                data-testid="button-new-import"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                New Import
              </Button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <StatCard
            label="Updated"
            value={run.updated}
            icon={RefreshCw}
            cls="text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800"
          />
          <StatCard
            label="Created"
            value={run.created}
            icon={PlusCircle}
            cls="text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800"
          />
          <StatCard
            label="Skipped"
            value={run.skipped}
            icon={SkipForward}
            cls="text-foreground bg-muted/30 border-border"
          />
          <StatCard
            label="Errors"
            value={run.errors}
            icon={XCircle}
            cls={
              run.errors > 0
                ? "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800"
                : "text-foreground bg-muted/30 border-border"
            }
          />
        </div>

        {warningCount > 0 && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800 text-sm text-yellow-700 dark:text-yellow-400 mb-6">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {warningCount} row{warningCount > 1 ? "s" : ""} updated with warnings — click a row to see details.
          </div>
        )}

        {/* Results table */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-sm font-medium">Row-by-Row Results</CardTitle>
                <CardDescription className="text-xs">
                  {filteredResults.length.toLocaleString()} of {results.length.toLocaleString()} rows shown · click any
                  row to expand field-level changes
                </CardDescription>
              </div>
              <div className="flex gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search SKU or name..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8 h-8 text-xs w-44"
                    data-testid="input-search-results"
                  />
                </div>
                <Select value={filterAction} onValueChange={setFilterAction}>
                  <SelectTrigger className="h-8 text-xs w-36" data-testid="select-filter-action">
                    <Filter className="w-3 h-3 mr-1" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All actions</SelectItem>
                    <SelectItem value="updated">Updated</SelectItem>
                    <SelectItem value="updated_with_warnings">Warnings</SelectItem>
                    <SelectItem value="created">Created</SelectItem>
                    <SelectItem value="skipped">Skipped</SelectItem>
                    <SelectItem value="error">Errors</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-3 py-2.5 text-muted-foreground font-medium w-12">#</th>
                    <th className="text-left px-3 py-2.5 text-muted-foreground font-medium">SKU</th>
                    <th className="text-left px-3 py-2.5 text-muted-foreground font-medium">Product</th>
                    <th className="text-left px-3 py-2.5 text-muted-foreground font-medium">Match</th>
                    <th className="text-left px-3 py-2.5 text-muted-foreground font-medium">Action</th>
                    <th className="text-left px-3 py-2.5 text-muted-foreground font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-10 text-muted-foreground">
                        No results match your filter.
                      </td>
                    </tr>
                  ) : (
                    filteredResults.map((r, i) => <ResultRow key={r.id} r={r} index={i} />)
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="mt-6 text-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/")}
            className="text-muted-foreground gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Start another import
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
