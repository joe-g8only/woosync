import { useState, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, API_BASE } from "@/lib/queryClient";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { IMPORT_MODES, type ImportMode, type DryRunResult, type PreCheckResult, type SkuConflict, type ConflictResolutions } from "@shared/schema";
import { ColumnMapper, type ColumnMapState } from "@/components/ColumnMapper";
import { AiRewritePanel } from "@/components/AiRewritePanel";
import { CategoryTreePreview } from "@/components/CategoryTreePreview";
import {
  Store,
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HelpCircle,
  RefreshCw,
  PlusCircle,
  DollarSign,
  Package,
  ArrowRight,
  ArrowLeft,
  Loader2,
  LogOut,
  ChevronDown,
  ChevronUp,
  Eye,
  Image as ImageIcon,
  Info,
  Settings2,
  FlaskConical,
  Pencil,
  Plus,
  Minus,
  ArrowRightLeft,
  Layers,
  ExternalLink,
  ShieldCheck,
  Tag,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

const MODE_ICONS: Record<ImportMode, React.ComponentType<any>> = {
  update_all: RefreshCw,
  add_new: PlusCircle,
  prices_only: DollarSign,
  stock_only: Package,
};

interface UploadResponse {
  columns: string[];
  preview: Record<string, any>[];
  total: number;
  hasSku: boolean;
  fileName: string;
  categoryRows?: { l1: string; l2: string; l3: string }[];
}

interface SkuCheckResult {
  sku: string;
  status: "found" | "not_found" | "multiple" | "error";
  productName?: string;
  productId?: number;
}

interface FieldMapping {
  id: number | null;
  sessionId: number;
  msrpKey: string;
  costKey: string;
  keyFeaturesKey: string;
}

type Step = "mode" | "upload" | "mapper" | "preview" | "prechecking" | "conflicts" | "review" | "running" | "done" | "dryrun";

// ── Field Mapping Sheet ────────────────────────────────────────────────────
function FieldMappingSheet({
  sessionId,
  mapping,
  onSaved,
}: {
  sessionId: string;
  mapping: FieldMapping | undefined;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  // Local draft state — committed on Save
  const [msrpKey, setMsrpKey] = useState(mapping?.msrpKey ?? "_msrp");
  const [costKey, setCostKey] = useState(mapping?.costKey ?? "_wc_cog_cost");
  const [kfKey, setKfKey] = useState(mapping?.keyFeaturesKey ?? "_key_features");

  // Reset drafts when sheet opens
  const handleOpen = (v: boolean) => {
    if (v && mapping) {
      setMsrpKey(mapping.msrpKey);
      setCostKey(mapping.costKey);
      setKfKey(mapping.keyFeaturesKey);
    }
    setOpen(v);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/field-mapping/${sessionId}`, {
        msrpKey: msrpKey.trim() || "_msrp",
        costKey: costKey.trim() || "_wc_cog_cost",
        keyFeaturesKey: kfKey.trim() || "_key_features",
      });
      return res.json() as Promise<FieldMapping>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/field-mapping", sessionId] });
      toast({ title: "Field mapping saved", description: "Meta keys updated for this session." });
      setOpen(false);
      onSaved();
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const FIELDS = [
    {
      id: "msrp",
      label: "MSRP",
      csvColumn: "Msrp",
      placeholder: "_msrp",
      value: msrpKey,
      set: setMsrpKey,
      hint: "The WordPress post meta key where MSRP is stored on your products.",
    },
    {
      id: "cost",
      label: "Cost",
      csvColumn: "Cost",
      placeholder: "_wc_cog_cost",
      value: costKey,
      set: setCostKey,
      hint: "Used by WooCommerce Cost of Goods, Profit Margin plugins, and custom solutions.",
    },
    {
      id: "kf",
      label: "Key Features",
      csvColumn: "Key Features",
      placeholder: "_key_features",
      value: kfKey,
      set: setKfKey,
      hint: "A pipe-separated or plain-text field used by many theme builders and review plugins.",
    },
  ];

  return (
    <Sheet open={open} onOpenChange={handleOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          data-testid="button-open-field-mapping"
        >
          <Settings2 className="w-3.5 h-3.5" />
          Field Mapping
          {mapping &&
            (mapping.msrpKey !== "_msrp" ||
              mapping.costKey !== "_wc_cog_cost" ||
              mapping.keyFeaturesKey !== "_key_features") && (
              <span className="w-1.5 h-1.5 rounded-full bg-primary ml-0.5" title="Custom mapping active" />
            )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Settings2 className="w-4 h-4 text-primary" />
            Field Mapping
          </SheetTitle>
          <SheetDescription className="text-xs leading-relaxed">
            WooCommerce stores custom data in product meta. Define which meta keys WooSync should
            write MSRP, Cost, and Key Features into. These settings are saved for this store session.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6">
          {FIELDS.map((f) => (
            <div key={f.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor={`field-${f.id}`} className="text-sm font-medium">
                  {f.label}
                </Label>
                <span className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
                  CSV: "{f.csvColumn}"
                </span>
              </div>
              <div className="relative">
                <Pencil className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  id={`field-${f.id}`}
                  value={f.value}
                  onChange={(e) => f.set(e.target.value)}
                  placeholder={f.placeholder}
                  className="pl-8 font-mono text-sm"
                  data-testid={`input-field-mapping-${f.id}`}
                />
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{f.hint}</p>
            </div>
          ))}

          <div className="p-3 rounded-lg bg-muted/50 border border-border">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-medium text-foreground">Blank fields are safe.</span> If the CSV
              value for any of these columns is empty, the meta key is left untouched in WooCommerce —
              regardless of this mapping.
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              className="flex-1"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              data-testid="button-save-field-mapping"
            >
              {saveMutation.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />Saving…</>
              ) : (
                "Save Mapping"
              )}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Status pill helper ───────────────────────────────────────────────────────────
function WooStatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    publish: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    draft: "bg-slate-100 text-slate-600 dark:bg-slate-800/50 dark:text-slate-400",
    pending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    private: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  };
  const cls = cfg[status] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

// ── Conflict Resolution Screen ─────────────────────────────────────────────────────
function ConflictResolutionScreen({
  preCheck,
  resolutions,
  onResolve,
  onBack,
  onProceed,
  isPending,
  dryRunEnabled,
}: {
  preCheck: PreCheckResult;
  resolutions: ConflictResolutions;
  onResolve: (sku: string, productId: number) => void;
  onBack: () => void;
  onProceed: () => void;
  isPending: boolean;
  dryRunEnabled: boolean;
}) {
  const unresolved = preCheck.conflicts.filter((c) => resolutions[c.sku] === undefined);
  const allResolved = unresolved.length === 0;

  return (
    <div className="space-y-6" data-testid="conflict-resolution-screen">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Layers className="w-4 h-4 text-amber-500" />
            <h2 className="text-base font-semibold text-foreground">Resolve SKU Conflicts</h2>
            <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-700">
              {preCheck.conflicts.length} conflict{preCheck.conflicts.length !== 1 ? "s" : ""}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-xl">
            The following SKUs match multiple products in your store. Pick the correct product for each one before the import runs — this ensures the right record is updated.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onBack} className="gap-1.5 text-xs" data-testid="button-conflicts-back">
            ← Back
          </Button>
          <Button
            size="sm"
            className={`gap-1.5 text-xs ${dryRunEnabled ? "bg-violet-600 hover:bg-violet-700 text-white" : ""}`}
            onClick={onProceed}
            disabled={!allResolved || isPending}
            data-testid="button-conflicts-proceed"
          >
            {isPending ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" />{dryRunEnabled ? "Simulating…" : "Running…"}</>
            ) : dryRunEnabled ? (
              <><FlaskConical className="w-3.5 h-3.5" />Preview Changes</>
            ) : (
              <>Run Import<ArrowRight className="w-3.5 h-3.5" /></>
            )}
          </Button>
        </div>
      </div>

      {/* Progress indicator */}
      <div className="flex items-center gap-3 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10">
        <ShieldCheck className={`w-4 h-4 shrink-0 ${allResolved ? "text-green-500" : "text-amber-500"}`} />
        <div className="flex-1">
          <div className="text-xs font-medium text-foreground">
            {allResolved
              ? "All conflicts resolved — ready to proceed"
              : `${unresolved.length} of ${preCheck.conflicts.length} conflict${preCheck.conflicts.length !== 1 ? "s" : ""} still need a selection`}
          </div>
        </div>
        <div className="flex gap-1">
          {preCheck.conflicts.map((c) => (
            <div
              key={c.sku}
              className={`w-2 h-2 rounded-full ${resolutions[c.sku] !== undefined ? "bg-green-500" : "bg-amber-400"}`}
              title={c.sku}
            />
          ))}
        </div>
      </div>

      {/* Conflict cards */}
      <div className="space-y-4">
        {preCheck.conflicts.map((conflict) => {
          const chosenId = resolutions[conflict.sku];
          return (
            <ConflictCard
              key={conflict.sku}
              conflict={conflict}
              chosenId={chosenId}
              onSelect={(id) => onResolve(conflict.sku, id)}
            />
          );
        })}
      </div>

      {/* Bottom proceed row */}
      <div className="p-4 rounded-lg border border-border bg-card flex items-center justify-between gap-4 flex-wrap">
        <div className="text-xs text-muted-foreground">
          {allResolved ? (
            <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              All {preCheck.conflicts.length} conflict{preCheck.conflicts.length !== 1 ? "s" : ""} resolved.
            </span>
          ) : (
            <span>Select a product for each conflicted SKU above to enable import.</span>
          )}
        </div>
        <Button
          size="sm"
          className={`gap-1.5 text-xs ${dryRunEnabled ? "bg-violet-600 hover:bg-violet-700 text-white" : ""}`}
          onClick={onProceed}
          disabled={!allResolved || isPending}
          data-testid="button-conflicts-proceed-bottom"
        >
          {isPending ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" />{dryRunEnabled ? "Simulating…" : "Running…"}</>
          ) : dryRunEnabled ? (
            <><FlaskConical className="w-3.5 h-3.5" />Preview Changes</>
          ) : (
            <>Run Import<ArrowRight className="w-3.5 h-3.5" /></>
          )}
        </Button>
      </div>
    </div>
  );
}

// ── Single SKU conflict card ───────────────────────────────────────────────────────────
function ConflictCard({
  conflict,
  chosenId,
  onSelect,
}: {
  conflict: SkuConflict;
  chosenId: number | undefined;
  onSelect: (id: number) => void;
}) {
  return (
    <Card
      className={`transition-all ${
        chosenId !== undefined
          ? "border-green-300 dark:border-green-700 bg-green-50/30 dark:bg-green-900/5"
          : "border-amber-300 dark:border-amber-700"
      }`}
      data-testid={`conflict-card-${conflict.sku}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          {chosenId !== undefined ? (
            <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-semibold text-foreground">{conflict.sku}</span>
              <Badge variant="secondary" className="text-xs">
                <Tag className="w-2.5 h-2.5 mr-1" />
                {conflict.candidates.length} matches
              </Badge>
              {conflict.rowNumbers.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  Row{conflict.rowNumbers.length > 1 ? "s" : ""} {conflict.rowNumbers.slice(0, 5).join(", ")}
                  {conflict.rowNumbers.length > 5 ? ` +${conflict.rowNumbers.length - 5} more` : ""}
                </span>
              )}
            </div>
            {chosenId !== undefined && (
              <div className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                Product #{chosenId} selected
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {conflict.candidates.map((candidate) => {
            const isChosen = chosenId === candidate.id;
            return (
              <button
                key={candidate.id}
                onClick={() => onSelect(candidate.id)}
                data-testid={`candidate-${conflict.sku}-${candidate.id}`}
                className={`relative text-left rounded-lg border p-3 transition-all ${
                  isChosen
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "border-border bg-card hover:border-primary/40 hover:bg-accent/20"
                }`}
              >
                {isChosen && (
                  <div className="absolute top-2 right-2">
                    <CheckCircle2 className="w-4 h-4 text-primary" />
                  </div>
                )}
                <div className="flex items-start gap-3">
                  {/* Product thumbnail */}
                  <div className="w-12 h-12 rounded-md border border-border bg-muted/50 overflow-hidden shrink-0 flex items-center justify-center">
                    {candidate.imageUrl ? (
                      <img
                        src={candidate.imageUrl}
                        alt={candidate.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <ImageIcon className="w-5 h-5 text-muted-foreground/50" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="text-xs font-semibold text-foreground truncate mb-1" title={candidate.name}>
                      {candidate.name}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <WooStatusBadge status={candidate.status} />
                      {candidate.regular_price && (
                        <span className="text-xs font-mono text-muted-foreground">${candidate.regular_price}</span>
                      )}
                      {candidate.stock_status === "instock" ? (
                        <span className="text-xs text-green-600 dark:text-green-400">In stock</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Out of stock</span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">ID #{candidate.id}</span>
                      {candidate.permalink && (
                        <a
                          href={candidate.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          View <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {chosenId === undefined && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Select the correct product above to resolve this conflict.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Dry-Run Results View ───────────────────────────────────────────────────
function DryRunResultsView({
  result,
  onConfirm,
  onBack,
  isConfirming,
  confirmLabel,
}: {
  result: DryRunResult;
  onConfirm: () => void;
  onBack: () => void;
  isConfirming: boolean;
  confirmLabel?: string;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const filtered = result.rows.filter((r) => {
    const matchSearch =
      !search ||
      r.sku.toLowerCase().includes(search.toLowerCase()) ||
      (r.productName || "").toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filter === "all" ||
      r.action === filter ||
      (filter === "changes" && r.changes.length > 0);
    return matchSearch && matchFilter;
  });

  const ACTION_CFG = {
    would_update: {
      label: "Would Update",
      cls: "text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800",
    },
    would_create: {
      label: "Would Create",
      cls: "text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800",
    },
    would_skip: {
      label: "Skip",
      cls: "text-muted-foreground bg-muted/30 border-border",
    },
    error: {
      label: "Error",
      cls: "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800",
    },
  };

  const modeLabel = IMPORT_MODES.find((m) => m.value === result.mode)?.label ?? result.mode;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FlaskConical className="w-4 h-4 text-violet-500" />
            <h2 className="text-base font-semibold text-foreground">Dry-Run Results</h2>
            <Badge variant="secondary" className="text-xs bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 border-violet-200 dark:border-violet-700">
              Simulation only
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{modeLabel}</span> · {result.fileName} · {result.totalRows} rows analysed — nothing has been written to your store.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onBack} className="gap-1.5 text-xs" data-testid="button-dryrun-back">
            ← Back
          </Button>
          <Button
            size="sm"
            className="gap-1.5 text-xs"
            onClick={onConfirm}
            disabled={isConfirming}
            data-testid="button-dryrun-confirm-import"
          >
            {isConfirming ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" />Running…</>
            ) : (
              <>{confirmLabel ?? "Run Real Import"} <ArrowRight className="w-3.5 h-3.5" /></>
            )}
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Would Update", value: result.wouldUpdate, icon: ArrowRightLeft, cls: "text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800" },
          { label: "Would Create", value: result.wouldCreate, icon: Plus, cls: "text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800" },
          { label: "Would Skip", value: result.wouldSkip, icon: Minus, cls: "text-foreground bg-muted/30 border-border" },
          { label: "Errors", value: result.errors, icon: XCircle, cls: result.errors > 0 ? "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800" : "text-foreground bg-muted/30 border-border" },
        ].map(({ label, value, icon: Icon, cls }) => (
          <div key={label} className={`rounded-lg border p-4 ${cls}`}>
            <div className="flex items-center gap-2 mb-1">
              <Icon className="w-4 h-4" />
              <span className="text-xs font-medium">{label}</span>
            </div>
            <div className="text-2xl font-bold">{value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-sm font-medium">Change Preview</CardTitle>
              <CardDescription className="text-xs">{filtered.length} of {result.rows.length} rows shown · expand a row to see field-level diffs</CardDescription>
            </div>
            <div className="flex gap-2 flex-wrap">
              <div className="relative">
                <Eye className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search SKU or name…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-8 text-xs w-44"
                  data-testid="input-dryrun-search"
                />
              </div>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                data-testid="select-dryrun-filter"
              >
                <option value="all">All actions</option>
                <option value="would_update">Would Update</option>
                <option value="would_create">Would Create</option>
                <option value="would_skip">Would Skip</option>
                <option value="changes">Has Changes</option>
                <option value="error">Errors</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-3 py-2.5 text-muted-foreground font-medium w-10">#</th>
                  <th className="text-left px-3 py-2.5 text-muted-foreground font-medium">SKU</th>
                  <th className="text-left px-3 py-2.5 text-muted-foreground font-medium">Product</th>
                  <th className="text-left px-3 py-2.5 text-muted-foreground font-medium">Action</th>
                  <th className="text-left px-3 py-2.5 text-muted-foreground font-medium">Changes</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-muted-foreground">
                      No rows match your filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => {
                    const cfg = ACTION_CFG[r.action] ?? ACTION_CFG.would_skip;
                    const isExpanded = expandedRow === r.rowNumber;
                    return (
                      <>
                        <tr
                          key={r.rowNumber}
                          className={`border-b border-border hover:bg-accent/20 transition-colors ${r.changes.length > 0 ? "cursor-pointer" : ""}`}
                          onClick={() => r.changes.length > 0 && setExpandedRow(isExpanded ? null : r.rowNumber)}
                          data-testid={`row-dryrun-${r.rowNumber}`}
                        >
                          <td className="px-3 py-2.5 text-muted-foreground">{r.rowNumber}</td>
                          <td className="px-3 py-2.5 font-mono font-medium text-foreground">{r.sku || <span className="italic text-muted-foreground">—</span>}</td>
                          <td className="px-3 py-2.5 text-muted-foreground max-w-[160px] truncate" title={r.productName ?? ""}>
                            {r.productName || <span className="italic">—</span>}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs font-medium ${cfg.cls}`}>
                              {cfg.label}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            {r.errorMessage ? (
                              <span className="text-red-600 dark:text-red-400">{r.errorMessage}</span>
                            ) : r.warnings.length > 0 ? (
                              <span className="text-yellow-600 dark:text-yellow-400">{r.warnings[0]}</span>
                            ) : r.changes.length > 0 ? (
                              <span className="text-muted-foreground">
                                {r.changes.length} field{r.changes.length > 1 ? "s" : ""} · {r.changes.slice(0, 2).map(c => c.field).join(", ")}{r.changes.length > 2 ? ` +${r.changes.length - 2}` : ""}
                              </span>
                            ) : (
                              <span className="text-muted-foreground italic">no changes</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground">
                            {r.changes.length > 0 && (
                              isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </td>
                        </tr>
                        {isExpanded && r.changes.length > 0 && (
                          <tr key={`${r.rowNumber}-detail`} className="border-b border-border bg-muted/20">
                            <td colSpan={6} className="px-6 py-3">
                              <div className="space-y-1.5">
                                <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Field-level diff</div>
                                {r.changes.map((ch, ci) => (
                                  <div key={ci} className="flex items-start gap-3 text-xs">
                                    <span className="font-mono text-foreground bg-muted px-1.5 py-0.5 rounded min-w-[120px] shrink-0">{ch.field}</span>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className={`px-1.5 py-0.5 rounded font-mono max-w-[200px] truncate ${ch.oldValue === null ? "text-muted-foreground italic" : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 line-through"}`}>
                                        {ch.oldValue === null ? "not set" : ch.oldValue}
                                      </span>
                                      <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                                      <span className="px-1.5 py-0.5 rounded font-mono bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 max-w-[200px] truncate">
                                        {ch.newValue}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Import Page ───────────────────────────────────────────────────────
export default function ImportPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("mode");
  const [mode, setMode] = useState<ImportMode>("prices_only");
  const [processImages, setProcessImages] = useState(true);
  const [dryRunEnabled, setDryRunEnabled] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [uploadData, setUploadData] = useState<UploadResponse | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [skuResults, setSkuResults] = useState<SkuCheckResult[] | null>(null);
  const [showAllColumns, setShowAllColumns] = useState(false);
  const [showFullPreview, setShowFullPreview] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  // Batch settings
  const [batchSize, setBatchSize] = useState(10);
  const [batchDelay, setBatchDelay] = useState(3);
  // Conflict resolution state
  const [preCheckResult, setPreCheckResult] = useState<PreCheckResult | null>(null);
  const [resolutions, setResolutions] = useState<ConflictResolutions>({});
  // Review & Omit: SKUs the user has unchecked and wants to skip
  const [omittedSkus, setOmittedSkus] = useState<Set<string>>(new Set());
  // Column mapper state
  const [columnMap, setColumnMap] = useState<ColumnMapState>({});
  // AI rewrite config
  const [aiRewriteConfig, setAiRewriteConfig] = useState({
    enabled: false,
    descriptionSourceCol: "Description",
    nameSourceCol: "Name",
    brandSourceCol: "Brand",
  });

  const sessionQuery = useQuery({
    queryKey: ["/api/session", sessionId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/session/${sessionId}`);
      return res.json() as Promise<{ storeUrl: string; storeName?: string }>;
    },
  });

  const fieldMappingQuery = useQuery({
    queryKey: ["/api/field-mapping", sessionId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/field-mapping/${sessionId}`);
      return res.json() as Promise<FieldMapping>;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("csv", file);
      const res = await fetch(`${API_BASE}/api/upload/${sessionId}`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }
      return res.json() as Promise<UploadResponse>;
    },
    onSuccess: (data) => {
      setUploadData(data);
      // Always go to mapper step so user can review/confirm column assignments
      setStep("mapper");
    },
    onError: (err: any) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const skuCheckMutation = useMutation({
    mutationFn: async (skus: string[]) => {
      const res = await apiRequest("POST", `/api/sku-check/${sessionId}`, { skus });
      const data = (await res.json()) as { results: SkuCheckResult[] };
      return data.results;
    },
    onSuccess: (results) => setSkuResults(results),
    onError: (err: any) => {
      toast({ title: "SKU check failed", description: err.message, variant: "destructive" });
    },
  });

  // Pre-check: scan CSV for conflicting SKUs before running
  const preCheckMutation = useMutation({
    mutationFn: async () => {
      if (!csvFile) throw new Error("No file");
      const form = new FormData();
      form.append("csv", csvFile);
      if (Object.keys(columnMap).length > 0) {
        form.append("columnMap", JSON.stringify(columnMap));
      }
      const res = await fetch(`${API_BASE}/api/pre-check/${sessionId}`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Pre-check failed");
      }
      return res.json() as Promise<PreCheckResult>;
    },
    onSuccess: (data) => {
      setPreCheckResult(data);
      if (data.conflicts.length > 0) {
        // Show conflict resolution screen
        setResolutions({});
        setStep("conflicts");
      } else {
        // No conflicts — proceed straight to import/dry-run
        proceedAfterConflicts({});
      }
    },
    onError: (err: any) => {
      toast({ title: "Pre-check failed", description: err.message, variant: "destructive" });
      setStep("preview");
    },
  });

  const dryRunMutation = useMutation({
    mutationFn: async (resolvedMap: ConflictResolutions) => {
      if (!csvFile) throw new Error("No file");
      const form = new FormData();
      form.append("csv", csvFile);
      form.append("mode", mode);
      if (Object.keys(resolvedMap).length > 0) {
        form.append("resolutions", JSON.stringify(resolvedMap));
      }
      if (Object.keys(columnMap).length > 0) {
        form.append("columnMap", JSON.stringify(columnMap));
      }
      const res = await fetch(`${API_BASE}/api/dry-run/${sessionId}`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Dry run failed");
      }
      return res.json() as Promise<DryRunResult>;
    },
    onSuccess: (data) => {
      setDryRunResult(data);
      setStep("dryrun");
    },
    onError: (err: any) => {
      toast({ title: "Dry run failed", description: err.message, variant: "destructive" });
      setStep("preview");
    },
  });

  const importMutation = useMutation({
    mutationFn: async (resolvedMap: ConflictResolutions) => {
      if (!csvFile) throw new Error("No file");
      setImportProgress(10);
      const form = new FormData();
      form.append("csv", csvFile);
      form.append("mode", mode);
      form.append("processImages", String(processImages));
      if (Object.keys(resolvedMap).length > 0) {
        form.append("resolutions", JSON.stringify(resolvedMap));
      }
      if (omittedSkus.size > 0) {
        form.append("omittedSkus", JSON.stringify([...omittedSkus]));
      }
      form.append("batchSize", String(batchSize));
      form.append("batchDelay", String(batchDelay * 1000));
      if (Object.keys(columnMap).length > 0) {
        form.append("columnMap", JSON.stringify(columnMap));
      }
      if (aiRewriteConfig.enabled) {
        form.append("aiRewrite", "true");
        form.append("aiDescriptionSourceCol", aiRewriteConfig.descriptionSourceCol);
        form.append("aiNameSourceCol", aiRewriteConfig.nameSourceCol);
        form.append("aiBrandSourceCol", aiRewriteConfig.brandSourceCol);
        if (aiRewriteConfig.openaiApiKey) form.append("aiOpenaiApiKey", aiRewriteConfig.openaiApiKey);
      }

      // Fire the import — server responds immediately with { runId }, then processes in background
      const res = await fetch(`${API_BASE}/api/import/${sessionId}`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Import failed");
      }
      const { runId } = await res.json();

      // Poll /api/runs/:runId/results until status is "complete"
      const pollInterval = 3000; // 3 seconds
      let attempts = 0;
      const maxAttempts = 600; // 30 minutes max
      while (attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, pollInterval));
        attempts++;
        try {
          const pollRes = await fetch(`${API_BASE}/api/runs/${runId}/results`);
          if (!pollRes.ok) continue;
          const data = await pollRes.json();
          const run = data.run;
          if (run) {
            // Update progress bar based on real processed count
            const pct = run.totalRows > 0 ? Math.round((run.processed / run.totalRows) * 95) : 10;
            setImportProgress(Math.max(10, pct));
            if (run.status === "complete") {
              setImportProgress(100);
              return { run, results: data.results } as { run: any; results: any[] };
            }
          }
        } catch { /* network blip — keep polling */ }
      }
      throw new Error("Import timed out — please check the Results page for partial progress.");
    },
    onSuccess: (data) => {
      navigate(`/results/${data.run.id}`);
    },
    onError: (err: any) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
      setStep("preview");
    },
  });

  // Called after conflict resolution (or immediately if no conflicts)
  // Called when ColumnMapper confirms the mapping — seed AI config with mapped column names
  const handleColumnMapComplete = (map: ColumnMapState) => {
    setColumnMap(map);
    // Auto-detect AI source columns from the mapping
    const reverseMap: Record<string, string> = {};
    for (const [src, target] of Object.entries(map)) {
      reverseMap[target] = src;
    }
    // Get the actual columns after mapping is applied
    const mappedColumns = (uploadData?.columns || []).map(c => map[c] || c).filter(c => c !== "(ignore)");
    // Find the best description column
    const descCol = reverseMap["Description"] || mappedColumns.find(c => c.toLowerCase().includes("desc") || c.toLowerCase().includes("long")) || "Description";
    const nameCol = reverseMap["Name"] || mappedColumns.find(c => c.toLowerCase().includes("name") || c.toLowerCase().includes("title")) || "Name";
    const brandCol = reverseMap["Brands"] || reverseMap["Brand"] || mappedColumns.find(c => c.toLowerCase().includes("brand") || c.toLowerCase().includes("mfr")) || "Brand";
    setAiRewriteConfig(prev => ({
      ...prev,
      descriptionSourceCol: descCol,
      nameSourceCol: nameCol,
      brandSourceCol: brandCol,
    }));
    setStep("preview");
  };

  const proceedAfterConflicts = (resolvedMap: ConflictResolutions) => {
    setStep("running");
    setImportProgress(5);
    if (dryRunEnabled) {
      dryRunMutation.mutate(resolvedMap);
    } else {
      importMutation.mutate(resolvedMap);
    }
  };

  const handleFileSelect = useCallback(
    (file: File) => {
      if (!file.name.endsWith(".csv")) {
        toast({ title: "Invalid file type", description: "Please upload a .csv file.", variant: "destructive" });
        return;
      }
      setCsvFile(file);
      uploadMutation.mutate(file);
      setStep("upload");
    },
    [uploadMutation, toast]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const runSkuCheck = () => {
    if (!uploadData) return;
    // Find the source column that maps to "SKU" (if any) so we can extract SKUs
    // even when the user mapped e.g. PartNumber → SKU
    const skuSourceCol = Object.entries(columnMap).find(([, v]) => v === "SKU")?.[0];
    const skus = uploadData.preview
      .map((r) => {
        // Try mapped source col first, then fall back to raw SKU/sku columns
        return (skuSourceCol ? r[skuSourceCol] : undefined) || r["SKU"] || r["sku"] || "";
      })
      .filter(Boolean)
      .slice(0, 10);
    skuCheckMutation.mutate(skus);
  };

  const handleRunImport = () => {
    // Always pre-check for conflicts first, then proceed
    setStep("prechecking");
    preCheckMutation.mutate();
  };

  const handleDisconnect = async () => {
    try {
      await apiRequest("DELETE", `/api/connect/${sessionId}`);
    } catch {}
    navigate("/");
  };

  const skuStatusIcon = (status: string) => {
    switch (status) {
      case "found": return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
      case "not_found": return <XCircle className="w-3.5 h-3.5 text-muted-foreground" />;
      case "multiple": return <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />;
      default: return <HelpCircle className="w-3.5 h-3.5 text-red-400" />;
    }
  };

  const skuStatusLabel = (status: string) => {
    switch (status) {
      case "found": return { label: "Found", class: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" };
      case "not_found": return { label: "Not Found", class: "bg-muted text-muted-foreground" };
      case "multiple": return { label: "Multiple", class: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" };
      default: return { label: "Error", class: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" };
    }
  };

  const visibleColumns = showAllColumns
    ? uploadData?.columns || []
    : (uploadData?.columns || []).slice(0, 8);
  const visiblePreview = showFullPreview
    ? uploadData?.preview || []
    : (uploadData?.preview || []).slice(0, 3);

  // ── Column Mapper step ─────────────────────────────────────────────────────
  if (step === "mapper" && uploadData) {
    return (
      <AppShell>
        <div className="max-w-3xl mx-auto px-6 py-10">
          <ColumnMapper
            sourceColumns={uploadData.columns}
            preview={uploadData.preview}
            onComplete={handleColumnMapComplete}
            onBack={() => {
              setCsvFile(null);
              setUploadData(null);
              setStep("mode");
            }}
          />
        </div>
      </AppShell>
    );
  }

  // ── Pre-check scanning screen ────────────────────────────────────────────
  if (step === "prechecking") {
    return (
      <AppShell>
        <div className="max-w-4xl mx-auto px-6 py-10">
          <Card>
            <CardContent className="py-12 flex flex-col items-center gap-5">
              <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center">
                <Loader2 className="w-7 h-7 animate-spin text-amber-600 dark:text-amber-400" />
              </div>
              <div className="text-center">
                <div className="text-sm font-semibold text-foreground mb-1">Scanning for Conflicts…</div>
                <div className="text-xs text-muted-foreground max-w-xs">
                  Checking each SKU in your CSV against the store to detect any that match multiple products.
                </div>
              </div>
              <Alert className="max-w-sm">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  This scan does not write any data to your store.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  // ── Conflict resolution screen ───────────────────────────────────────────
  if (step === "conflicts" && preCheckResult) {
    return (
      <AppShell>
        <div className="max-w-4xl mx-auto px-6 py-10">
          <ConflictResolutionScreen
            preCheck={preCheckResult}
            resolutions={resolutions}
            onResolve={(sku, productId) => setResolutions((prev) => ({ ...prev, [sku]: productId }))}
            onBack={() => setStep("preview")}
            onProceed={() => proceedAfterConflicts(resolutions)}
            isPending={importMutation.isPending || dryRunMutation.isPending}
            dryRunEnabled={dryRunEnabled}
          />
        </div>
      </AppShell>
    );
  }

  // ── Dry-run results view ────────────────────────────────────────────────
  if (step === "dryrun" && dryRunResult) {
    return (
      <AppShell>
        <div className="max-w-4xl mx-auto px-6 py-10">
          <DryRunResultsView
            result={dryRunResult}
            onBack={() => setStep("preview")}
            isConfirming={false}
            onConfirm={() => {
              // Go to Review & Omit step so user can deselect rows
              setOmittedSkus(new Set());
              setStep("review");
            }}
            confirmLabel="Review & Omit…"
          />
        </div>
      </AppShell>
    );
  }

  // ── Review & Omit step ────────────────────────────────────────────────────
  if (step === "review" && dryRunResult) {
    const rowsWithChanges = dryRunResult.rows.filter(
      (r) => r.changes.length > 0 || r.action === "create"
    );

    const allChecked = rowsWithChanges.every((r) => !omittedSkus.has(r.sku ?? ""));
    const someChecked = rowsWithChanges.some((r) => !omittedSkus.has(r.sku ?? ""));
    const includedCount = rowsWithChanges.filter((r) => !omittedSkus.has(r.sku ?? "")).length;

    const toggleSku = (sku: string) => {
      setOmittedSkus((prev) => {
        const next = new Set(prev);
        if (next.has(sku)) next.delete(sku); else next.add(sku);
        return next;
      });
    };

    const toggleAll = () => {
      if (allChecked) {
        setOmittedSkus(new Set(rowsWithChanges.map((r) => r.sku ?? "")));
      } else {
        setOmittedSkus(new Set());
      }
    };

    return (
      <AppShell>
        <div className="max-w-4xl mx-auto px-6 py-10">
          <div className="mb-6">
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground mb-4" onClick={() => setStep("dryrun")}>
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Dry-Run
            </Button>
            <h2 className="text-xl font-semibold text-foreground mb-1">Review & Omit</h2>
            <p className="text-sm text-muted-foreground">
              Uncheck any rows you want to skip. Only checked rows will be sent to your store.
            </p>
          </div>

          {/* Summary bar */}
          <div className="flex items-center justify-between gap-4 p-3.5 rounded-lg border border-border bg-card mb-4 flex-wrap">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                className="w-4 h-4 accent-primary cursor-pointer"
                checked={allChecked}
                ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked; }}
                onChange={toggleAll}
                data-testid="checkbox-select-all"
              />
              <span className="text-sm text-foreground">
                <span className="font-semibold">{includedCount}</span> of{" "}
                <span className="font-semibold">{rowsWithChanges.length}</span> rows selected
              </span>
              {omittedSkus.size > 0 && (
                <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                  {omittedSkus.size} row{omittedSkus.size !== 1 ? "s" : ""} will be skipped
                </span>
              )}
            </div>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={includedCount === 0 || importMutation.isPending}
              onClick={() => {
                setDryRunEnabled(false);
                setStep("running");
                setImportProgress(5);
                importMutation.mutate(resolutions);
              }}
              data-testid="button-run-import-from-review"
            >
              {importMutation.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…</>
              ) : (
                <>Run Import ({includedCount} rows) <ArrowRight className="w-3.5 h-3.5" /></>
              )}
            </Button>
          </div>

          {rowsWithChanges.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              No changes were detected — nothing to review.
            </div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="text-xs w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="px-3 py-2.5 w-10"></th>
                        <th className="text-left px-3 py-2.5 text-muted-foreground font-medium">#</th>
                        <th className="text-left px-3 py-2.5 text-muted-foreground font-medium">SKU</th>
                        <th className="text-left px-3 py-2.5 text-muted-foreground font-medium">Product</th>
                        <th className="text-left px-3 py-2.5 text-muted-foreground font-medium">Action</th>
                        <th className="text-left px-3 py-2.5 text-muted-foreground font-medium">Changes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rowsWithChanges.map((row, i) => {
                        const sku = row.sku ?? "";
                        const checked = !omittedSkus.has(sku);
                        return (
                          <tr
                            key={i}
                            onClick={() => toggleSku(sku)}
                            className={`border-b border-border cursor-pointer transition-colors ${
                              checked ? "hover:bg-accent/10" : "opacity-40 bg-muted/20 hover:opacity-60"
                            }`}
                            data-testid={`review-row-${sku}`}
                          >
                            <td className="px-3 py-2.5 text-center">
                              <input
                                type="checkbox"
                                className="w-3.5 h-3.5 accent-primary cursor-pointer"
                                checked={checked}
                                onChange={() => toggleSku(sku)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground">{row.rowNumber}</td>
                            <td className="px-3 py-2.5 font-mono font-medium text-foreground">{sku || <span className="italic text-muted-foreground">—</span>}</td>
                            <td className="px-3 py-2.5 text-muted-foreground max-w-[160px] truncate" title={row.productName || ""}>{row.productName || <span className="italic">—</span>}</td>
                            <td className="px-3 py-2.5">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                row.action === "create"
                                  ? "text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/30"
                                  : "text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/30"
                              }`}>
                                {row.action === "create" ? "Create" : "Update"}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground">
                              {row.changes.length > 0 ? (
                                <span className="text-indigo-600 dark:text-indigo-400">
                                  {row.changes.map((c) => c.field).join(", ")}
                                </span>
                              ) : (
                                <span className="italic">new product</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-6 py-10">

        {/* Session banner */}
        {sessionQuery.isLoading ? (
          <Skeleton className="h-10 w-full mb-6 rounded-lg" />
        ) : sessionQuery.data ? (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card mb-8">
            <Store className="w-4 h-4 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-foreground truncate block">
                {sessionQuery.data.storeName || sessionQuery.data.storeUrl}
              </span>
              {sessionQuery.data.storeName && (
                <span className="text-xs text-muted-foreground truncate block">{sessionQuery.data.storeUrl}</span>
              )}
            </div>
            <Badge variant="secondary" className="shrink-0 text-xs text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/40">
              Connected
            </Badge>
            {/* Field Mapping button lives in the session banner */}
            <FieldMappingSheet
              sessionId={sessionId}
              mapping={fieldMappingQuery.data}
              onSaved={() => {}}
            />
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 text-muted-foreground hover:text-foreground gap-1.5"
              onClick={handleDisconnect}
              data-testid="button-disconnect-session"
            >
              <LogOut className="w-3.5 h-3.5" />
              Disconnect
            </Button>
          </div>
        ) : null}

        {/* STEP 1: Mode selector */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center">1</div>
            <h2 className="text-base font-semibold text-foreground">Choose Import Mode</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {IMPORT_MODES.map((m) => {
              const Icon = MODE_ICONS[m.value];
              const isSelected = mode === m.value;
              return (
                <button
                  key={m.value}
                  data-testid={`button-mode-${m.value}`}
                  onClick={() => setMode(m.value)}
                  className={`text-left p-4 rounded-lg border transition-all ${
                    isSelected
                      ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                      : "border-border bg-card hover:border-primary/40 hover:bg-accent/30"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground mb-0.5">{m.label}</div>
                      <div className="text-xs text-muted-foreground leading-relaxed">{m.description}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* STEP 2: Upload */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center">2</div>
            <h2 className="text-base font-semibold text-foreground">Upload CSV File</h2>
          </div>

          {step === "upload" && uploadMutation.isPending ? (
            <Card>
              <CardContent className="py-10 flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Reading your file...</p>
              </CardContent>
            </Card>
          ) : uploadData ? (
            <Card className="border-green-200 dark:border-green-800">
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{uploadData.fileName}</div>
                    <div className="text-xs text-muted-foreground">{uploadData.total.toLocaleString()} rows · {uploadData.columns.length} columns detected</div>
                  </div>
                  <Badge variant="secondary" className="shrink-0 text-xs text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/40">
                    Loaded
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground"
                    onClick={() => {
                      setUploadData(null);
                      setSkuResults(null);
                      setCsvFile(null);
                      setDryRunResult(null);
                      setStep("mode");
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    data-testid="button-remove-file"
                  >
                    Replace
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div
              data-testid="dropzone-csv"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-border rounded-lg p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-primary/50 hover:bg-accent/20 transition-all"
            >
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Upload className="w-6 h-6 text-primary" />
              </div>
              <div className="text-center">
                <div className="text-sm font-medium text-foreground mb-1">Drop your CSV here, or click to browse</div>
                <div className="text-xs text-muted-foreground">UTF-8 encoded, comma-separated. Max 20 MB.</div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileChange}
                data-testid="input-file-csv"
              />
            </div>
          )}
        </div>

        {/* STEP 3: Preview & Validate */}
        {uploadData && step !== "running" && (
          <div className="mb-8">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center">3</div>
                <h2 className="text-base font-semibold text-foreground">Preview & Validate</h2>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => setStep("mapper")}
                data-testid="button-edit-column-map"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Edit Column Map
              </Button>
            </div>

            {/* Columns */}
            <Card className="mb-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Detected Columns</CardTitle>
                <CardDescription className="text-xs">
                  {uploadData.columns.length} columns found in your file.
                  {!uploadData.hasSku && !Object.values(columnMap).some(v => v === "SKU") && (
                    <span className="text-yellow-600 dark:text-yellow-400 ml-1">
                      Warning: No SKU column detected.
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {visibleColumns.map((col) => (
                    <Badge
                      key={col}
                      variant="secondary"
                      className={`text-xs ${col.toLowerCase().includes("sku") ? "bg-primary/10 text-primary border-primary/20" : ""}`}
                    >
                      {col}
                    </Badge>
                  ))}
                  {uploadData.columns.length > 8 && (
                    <button
                      className="text-xs text-primary hover:underline flex items-center gap-0.5"
                      onClick={() => setShowAllColumns(!showAllColumns)}
                    >
                      {showAllColumns ? <><ChevronUp className="w-3 h-3" /> Show less</> : <><ChevronDown className="w-3 h-3" /> +{uploadData.columns.length - 8} more</>}
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Data preview */}
            <Card className="mb-4 overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm font-medium">Data Preview</CardTitle>
                    <CardDescription className="text-xs">First {Math.min(3, uploadData.preview.length)} of {uploadData.total} rows</CardDescription>
                  </div>
                  <Eye className="w-4 h-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="text-xs w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        {uploadData.columns.slice(0, 7).map((col) => (
                          <th key={col} className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">{col}</th>
                        ))}
                        {uploadData.columns.length > 7 && (
                          <th className="text-left px-3 py-2 text-muted-foreground font-medium">+{uploadData.columns.length - 7} more</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {visiblePreview.map((row, i) => (
                        <tr key={i} className="border-b border-border last:border-0 hover:bg-accent/20 transition-colors">
                          {uploadData.columns.slice(0, 7).map((col) => (
                            <td key={col} className="px-3 py-2 text-foreground whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis" title={String(row[col] || "")}>
                              {row[col] ? String(row[col]).slice(0, 40) + (String(row[col]).length > 40 ? "…" : "") : <span className="text-muted-foreground italic">empty</span>}
                            </td>
                          ))}
                          {uploadData.columns.length > 7 && <td className="px-3 py-2 text-muted-foreground">…</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {uploadData.preview.length > 3 && (
                  <div className="px-3 py-2 border-t border-border">
                    <button className="text-xs text-primary hover:underline" onClick={() => setShowFullPreview(!showFullPreview)}>
                      {showFullPreview ? "Show fewer rows" : `Show all ${uploadData.preview.length} preview rows`}
                    </button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Category Tree Preview */}
            {uploadData.categoryRows && uploadData.categoryRows.some(r => r.l1) && (
              <CategoryTreePreview
                categoryRows={uploadData.categoryRows}
                columnMap={columnMap}
              />
            )}

                        {/* SKU Check */}
            <Card className="mb-4">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <CardTitle className="text-sm font-medium">SKU Validation</CardTitle>
                    <CardDescription className="text-xs">Check if your SKUs exist in the store (sample of first 10)</CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={runSkuCheck}
                    disabled={skuCheckMutation.isPending || (!uploadData.hasSku && !Object.values(columnMap).some(v => v === "SKU"))}
                    data-testid="button-run-sku-check"
                    className="gap-1.5 text-xs"
                  >
                    {skuCheckMutation.isPending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking...</> : <>Run SKU Check</>}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {!skuResults && !skuCheckMutation.isPending && (
                  <p className="text-xs text-muted-foreground">
                    {(uploadData.hasSku || Object.values(columnMap).some(v => v === "SKU"))
                      ? "Click 'Run SKU Check' to validate your product identifiers against the store."
                      : "No SKU column detected. SKU is required for matching products."}
                  </p>
                )}
                {skuCheckMutation.isPending && (
                  <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 w-full rounded" />)}</div>
                )}
                {skuResults && (
                  <div className="space-y-1.5">
                    {skuResults.map((r) => {
                      const { label, class: cls } = skuStatusLabel(r.status);
                      return (
                        <div key={r.sku} className="flex items-center gap-2 p-2 rounded-md bg-muted/30">
                          {skuStatusIcon(r.status)}
                          <span className="text-xs font-mono font-medium text-foreground">{r.sku}</span>
                          {r.productName && <span className="text-xs text-muted-foreground truncate flex-1">{r.productName}</span>}
                          <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
                        </div>
                      );
                    })}
                    <div className="pt-2 flex gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-500" /> {skuResults.filter(r => r.status === "found").length} found</span>
                      <span className="flex items-center gap-1"><XCircle className="w-3 h-3" /> {skuResults.filter(r => r.status === "not_found").length} not found</span>
                      {skuResults.some(r => r.status === "multiple") && <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-yellow-500" /> {skuResults.filter(r => r.status === "multiple").length} multiple</span>}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Image processing toggle */}
            {(mode === "update_all" || mode === "add_new") && uploadData.columns.some(c => c.toLowerCase() === "images") && (
              <Card className="mb-4">
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <ImageIcon className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <Label htmlFor="toggle-images" className="text-sm font-medium cursor-pointer">
                          Process &amp; Normalize Images
                        </Label>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed max-w-md">
                          Downloads each image URL, pads it to a square white canvas, resizes to 1000×1000 px, and uploads to your media library.
                        </p>
                        {processImages && (
                          <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>Image processing adds significant time — allow extra minutes for large imports.</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <Switch id="toggle-images" checked={processImages} onCheckedChange={setProcessImages} data-testid="toggle-process-images" />
                  </div>
                  {processImages && (
                    <div className="mt-4 pt-4 border-t border-border grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {[
                        { label: "Download", desc: "Fetches each URL from the Images column" },
                        { label: "Pad to Square", desc: "White canvas, longest side × longest side, centred" },
                        { label: "Resize to 1000×1000", desc: "JPEG output, Lanczos filter, quality 90" },
                      ].map((s) => (
                        <div key={s.label} className="flex items-start gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                          <div>
                            <div className="text-xs font-medium text-foreground">{s.label}</div>
                            <div className="text-xs text-muted-foreground">{s.desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Dry-run toggle */}
            <Card className="mb-4">
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${dryRunEnabled ? "bg-violet-100 dark:bg-violet-900/30" : "bg-muted"}`}>
                      <FlaskConical className={`w-4 h-4 ${dryRunEnabled ? "text-violet-600 dark:text-violet-400" : "text-muted-foreground"}`} />
                    </div>
                    <div>
                      <Label htmlFor="toggle-dryrun" className="text-sm font-medium cursor-pointer">
                        Dry-Run Mode
                      </Label>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed max-w-md">
                        Simulates the full import against your live store data and shows exactly which fields would change per SKU — without writing anything.
                      </p>
                      {dryRunEnabled && (
                        <div className="mt-2 flex items-start gap-1.5 text-xs text-violet-600 dark:text-violet-400">
                          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span>No data will be written. Review the diff before committing.</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <Switch id="toggle-dryrun" checked={dryRunEnabled} onCheckedChange={setDryRunEnabled} data-testid="toggle-dry-run" />
                </div>
              </CardContent>
            </Card>

            {/* Batch settings card */}
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-foreground">Batch Processing</span>
                  <span className="text-xs text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 rounded font-medium">Protects your store</span>
                </div>
                <p className="text-xs text-muted-foreground mb-4">Rows are sent in batches with a pause between each to prevent overloading your store.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-xs font-medium">Batch size</Label>
                      <span className="text-xs font-mono font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded">{batchSize} rows</span>
                    </div>
                    <input type="range" min={1} max={50} step={1} value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} className="w-full h-1.5 accent-primary cursor-pointer" data-testid="slider-batch-size" />
                    <div className="flex justify-between text-xs text-muted-foreground mt-1"><span>1 (safest)</span><span>50 (fastest)</span></div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-xs font-medium">Pause between batches</Label>
                      <span className="text-xs font-mono font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded">{batchDelay}s</span>
                    </div>
                    <input type="range" min={0} max={15} step={1} value={batchDelay} onChange={(e) => setBatchDelay(Number(e.target.value))} className="w-full h-1.5 accent-primary cursor-pointer" data-testid="slider-batch-delay" />
                    <div className="flex justify-between text-xs text-muted-foreground mt-1"><span>0s (no pause)</span><span>15s</span></div>
                  </div>
                </div>
                {uploadData && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    Est. time: ~{Math.ceil((uploadData.total * 0.5 + Math.floor(uploadData.total / batchSize) * batchDelay) / 60)} min for {uploadData.total} rows
                  </div>
                )}
              </CardContent>
            </Card>


            {/* AI Description Rewrite Panel */}
            <AiRewritePanel
              csvColumns={(uploadData?.columns || []).map(c => columnMap[c] || c).filter(c => c !== "(ignore)")}
              sampleRow={uploadData?.preview?.[0] ? 
                (() => {
                  const row: Record<string, any> = {};
                  for (const [k, v] of Object.entries(uploadData.preview[0])) {
                    row[columnMap[k] || k] = v;
                  }
                  return row;
                })() 
                : undefined
              }
              config={aiRewriteConfig}
              onChange={setAiRewriteConfig}
            />

            {/* Run/Dry-run button row */}
            <div className="p-5 rounded-lg border border-border bg-card">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-foreground mb-0.5">
                    {dryRunEnabled ? (
                      <>
                        Simulate: <span className="text-violet-600 dark:text-violet-400">{IMPORT_MODES.find(m => m.value === mode)?.label}</span>
                        <span className="ml-2 text-xs font-normal text-violet-600 dark:text-violet-400 bg-violet-100 dark:bg-violet-900/30 px-2 py-0.5 rounded-full">Dry run</span>
                      </>
                    ) : (
                      <>
                        Ready to run: <span className="text-primary">{IMPORT_MODES.find(m => m.value === mode)?.label}</span>
                        {processImages && <span className="ml-2 text-xs font-normal text-primary bg-primary/10 px-2 py-0.5 rounded-full">+ Images</span>}
                      </>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {uploadData.total.toLocaleString()} rows will be {dryRunEnabled ? "analysed" : "processed"} · Blank fields will not overwrite existing data
                  </div>
                </div>
                <Button
                  size="lg"
                  className={`gap-2 shrink-0 ${dryRunEnabled ? "bg-violet-600 hover:bg-violet-700 text-white" : ""}`}
                  onClick={handleRunImport}
                  disabled={importMutation.isPending || dryRunMutation.isPending}
                  data-testid="button-run-import"
                >
                  {dryRunEnabled ? (
                    <><FlaskConical className="w-4 h-4" />Preview Changes</>
                  ) : (
                    <>Run Import<ArrowRight className="w-4 h-4" /></>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Running progress */}
        {step === "running" && (
          <div className="mb-8">
            <Card>
              <CardContent className="py-10 flex flex-col items-center gap-5">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center ${dryRunEnabled ? "bg-violet-100 dark:bg-violet-900/20" : "bg-primary/10"}`}>
                  <Loader2 className={`w-7 h-7 animate-spin ${dryRunEnabled ? "text-violet-600 dark:text-violet-400" : "text-primary"}`} />
                </div>
                <div className="text-center">
                  <div className="text-sm font-semibold text-foreground mb-1">
                    {dryRunEnabled ? "Simulating Import…" : "Import in Progress"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {dryRunEnabled
                      ? `Analysing ${uploadData?.total.toLocaleString()} rows against your store — nothing is being written`
                      : `Processing ${uploadData?.total.toLocaleString()} rows — please don't close this window`}
                  </div>
                </div>
                {!dryRunEnabled && (
                  <div className="w-full max-w-sm">
                    <Progress value={importProgress} className="h-2" />
                    <div className="text-xs text-muted-foreground text-center mt-2">{importProgress}%</div>
                  </div>
                )}
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    {dryRunEnabled
                      ? "Each row is checked against WooCommerce. This may take a moment."
                      : "This may take several minutes for large catalogs."}
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}
