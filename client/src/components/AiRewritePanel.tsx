/**
 * AiRewritePanel — toggle + configure AI description rewriting.
 * Shows a live preview of the rewrite from a sample row.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, API_BASE } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sparkles,
  Eye,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

interface RewrittenDescription {
  shortDescription: string;
  keyFeatures: string[];
  longDescription: string;
}

interface AiRewriteConfig {
  enabled: boolean;
  descriptionSourceCol: string;   // which CSV col has the source description
  nameSourceCol: string;
  brandSourceCol: string;
}

interface AiRewritePanelProps {
  csvColumns: string[];           // all columns available in the CSV (after column mapping)
  sampleRow?: Record<string, any>; // first CSV row for preview
  config: AiRewriteConfig;
  onChange: (config: AiRewriteConfig) => void;
}

export function AiRewritePanel({ csvColumns, sampleRow, config, onChange }: AiRewritePanelProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<RewrittenDescription | null>(null);

  const previewMutation = useMutation({
    mutationFn: async () => {
      const description = sampleRow?.[config.descriptionSourceCol] ||
        sampleRow?.["Description"] || sampleRow?.["Long Description(150)"] || "";
      const productName = sampleRow?.[config.nameSourceCol] || sampleRow?.["Name"] || "";
      const brand = sampleRow?.[config.brandSourceCol] || sampleRow?.["Brand"] || "";

      const res = await fetch(`${API_BASE}/api/rewrite-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, productName, brand }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || "Request failed");
      }
      return res.json() as Promise<RewrittenDescription>;
    },
    onSuccess: (data) => {
      setPreview(data);
      setPreviewOpen(true);
    },
  });

  // Columns that likely contain description text
  const descColumns = csvColumns.filter(col => {
    const c = col.toLowerCase();
    return c.includes("desc") || c.includes("detail") || c.includes("note") || c.includes("feature") || c.includes("about");
  });

  return (
    <div className="space-y-4">
      {/* Toggle row */}
      <div className="flex items-center justify-between rounded-lg border p-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-violet-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <Label htmlFor="ai-rewrite-toggle" className="font-medium cursor-pointer">
                AI Description Rewrite
              </Label>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">New</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Auto-generate Short Description, Key Features &amp; Long Description from your supplier text
            </p>
          </div>
        </div>
        <Switch
          id="ai-rewrite-toggle"
          checked={config.enabled}
          onCheckedChange={(checked) => onChange({ ...config, enabled: checked })}
          data-testid="switch-ai-rewrite"
        />
      </div>

      {config.enabled && (
        <Card className="border-violet-500/20 bg-violet-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-500" />
              Rewrite Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Source column selectors */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Description source column</Label>
                <Select
                  value={config.descriptionSourceCol}
                  onValueChange={(v) => onChange({ ...config, descriptionSourceCol: v })}
                >
                  <SelectTrigger className="h-8 text-xs" data-testid="select-ai-desc-col">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {csvColumns.map(col => (
                      <SelectItem key={col} value={col}>{col}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">Source text to rewrite</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Product name column</Label>
                <Select
                  value={config.nameSourceCol || "__none__"}
                  onValueChange={(v) => onChange({ ...config, nameSourceCol: v === "__none__" ? "" : v })}
                >
                  <SelectTrigger className="h-8 text-xs" data-testid="select-ai-name-col">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">(none)</SelectItem>
                    {csvColumns.map(col => (
                      <SelectItem key={col} value={col}>{col}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">For context in rewrite</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Brand column</Label>
                <Select
                  value={config.brandSourceCol || "__none__"}
                  onValueChange={(v) => onChange({ ...config, brandSourceCol: v === "__none__" ? "" : v })}
                >
                  <SelectTrigger className="h-8 text-xs" data-testid="select-ai-brand-col">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">(none)</SelectItem>
                    {csvColumns.map(col => (
                      <SelectItem key={col} value={col}>{col}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">For context in rewrite</p>
              </div>
            </div>

            {/* What gets written */}
            <div className="rounded-lg bg-background/60 border p-3 space-y-2">
              <p className="text-xs font-medium">What the AI will generate for each product:</p>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <div className="flex gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-medium text-foreground">Short Description</span> — 1-2 punchy sentences above the fold highlighting the key problem it solves
                  </div>
                </div>
                <div className="flex gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-medium text-foreground">Key Features</span> — 4–7 bullet points (install ease, materials, fitment, performance gains, etc.)
                  </div>
                </div>
                <div className="flex gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-medium text-foreground">Long Description</span> — 150–250 word high-converting HTML description with pain point → features → fitment arc
                  </div>
                </div>
              </div>
            </div>

            {/* Preview button */}
            {sampleRow && (
              <div className="space-y-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-violet-600 border-violet-500/30 hover:bg-violet-500/10"
                  onClick={() => previewMutation.mutate()}
                  disabled={previewMutation.isPending}
                  data-testid="btn-ai-preview"
                >
                  {previewMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                  {previewMutation.isPending ? "Generating preview…" : "Preview rewrite on first row"}
                </Button>

                {previewMutation.isError && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      {(previewMutation.error as Error)?.message || "Preview failed"}
                    </AlertDescription>
                  </Alert>
                )}

                {preview && (
                  <div className="rounded-lg border bg-background overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-muted/50 transition-colors"
                      onClick={() => setPreviewOpen(v => !v)}
                    >
                      <span className="flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                        AI Rewrite Preview
                      </span>
                      {previewOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>

                    {previewOpen && (
                      <div className="p-4 pt-0 space-y-4 border-t">
                        {/* Short description */}
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Short Description</p>
                          <p className="text-sm">{preview.shortDescription}</p>
                        </div>

                        {/* Key features */}
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Key Features</p>
                          <ul className="space-y-1">
                            {preview.keyFeatures.map((f, i) => (
                              <li key={i} className="flex items-start gap-2 text-sm">
                                <span className="text-violet-500 font-bold mt-0.5">•</span>
                                {f}
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* Long description */}
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Long Description</p>
                          <div
                            className="text-sm prose prose-sm max-w-none dark:prose-invert"
                            dangerouslySetInnerHTML={{ __html: preview.longDescription }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <Alert className="border-amber-500/30 bg-amber-500/5">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <AlertDescription className="text-xs">
                AI rewrites run per row during import and consume one API call per product.
                Rows with blank description columns are left unchanged.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
