import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Upload, FileText, Download, AlertTriangle, CheckCircle2, RefreshCw, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

type ConvertState = "idle" | "converting" | "done" | "error";

interface ConvertResult {
  csv: string;
  productCount: number;
  variantCount: number;
  warnings: string[];
}

export default function ShopifyConvertPage() {
  const [, navigate] = useLocation();
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [state, setState] = useState<ConvertState>("idle");
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [error, setError] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    if (!f.name.endsWith(".csv")) {
      setError("Please upload a .csv file.");
      return;
    }
    setFile(f);
    setError("");
    setResult(null);
    setState("idle");
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);

  const convert = async () => {
    if (!file) return;
    setState("converting");
    setError("");
    setResult(null);

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/shopify-convert", {
        method: "POST",
        body: form,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Conversion failed");

      setResult(data);
      setState("done");
    } catch (err: any) {
      setError(err.message || "Something went wrong");
      setState("error");
    }
  };

  const download = () => {
    if (!result) return;
    const blob = new Blob([result.csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const originalName = file?.name.replace(/\.csv$/i, "") || "shopify-export";
    a.download = `${originalName}-woocommerce.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setError("");
    setState("idle");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <ShoppingBag className="w-4 h-4 text-orange-500" />
            </div>
            <span className="text-sm font-semibold">Convert Shopify Export</span>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-8">

        {/* Explainer */}
        <div>
          <h1 className="text-xl font-bold mb-1">Shopify → WooCommerce</h1>
          <p className="text-sm text-muted-foreground">
            Upload your Shopify product export CSV. The converter will format titles in Title Case,
            set vendor names to FULL CAPS, collapse images, extract clean tags, and handle variants
            — outputting a WooCommerce-ready CSV you can import directly with WooSync.
          </p>
        </div>

        {/* What it does */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          {[
            ["Title Case titles", "Every word capitalised"],
            ["VENDOR in FULL CAPS", "Even when inside the title"],
            ["Variants detected", "Options become WooCommerce attributes"],
            ["Images collapsed", "All images per product joined"],
            ["Tags cleaned", "Strips internal Bucket/fits_ tags"],
            ["Status mapped", "active → publish, archived → draft"],
          ].map(([label, desc]) => (
            <div key={label} className="flex items-start gap-2 p-3 rounded-lg bg-muted/40 border border-border/40">
              <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div>
                <div className="font-medium text-xs">{label}</div>
                <div className="text-muted-foreground text-xs">{desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Upload zone */}
        {state !== "done" && (
          <div
            className={`relative rounded-xl border-2 border-dashed transition-all cursor-pointer
              ${dragOver
                ? "border-primary bg-primary/5"
                : file
                  ? "border-primary/40 bg-primary/5"
                  : "border-border hover:border-primary/40 hover:bg-muted/30"
              }`}
            onClick={() => inputRef.current?.click()}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <div className="py-12 flex flex-col items-center gap-3 text-center">
              {file ? (
                <>
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <FileText className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(file.size / 1024).toFixed(1)} KB — click to replace
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
                    <Upload className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Drop your Shopify export here</p>
                    <p className="text-xs text-muted-foreground mt-0.5">or click to browse — .csv files only</p>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Convert button */}
        {file && state !== "done" && (
          <Button
            className="w-full"
            size="lg"
            onClick={convert}
            disabled={state === "converting"}
          >
            {state === "converting" ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Converting…
              </>
            ) : (
              <>
                <ShoppingBag className="w-4 h-4 mr-2" />
                Convert to WooCommerce CSV
              </>
            )}
          </Button>
        )}

        {/* Results */}
        {state === "done" && result && (
          <div className="space-y-5">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Products", value: result.productCount },
                { label: "Variations", value: result.variantCount },
                { label: "Warnings", value: result.warnings.length },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl border border-border/50 bg-card p-4 text-center">
                  <div className="text-2xl font-bold">{value}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
                </div>
              ))}
            </div>

            {/* Warnings */}
            {result.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-1.5">
                <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 text-xs font-semibold">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Warnings
                </div>
                {result.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-700 dark:text-amber-300 pl-5">{w}</p>
                ))}
              </div>
            )}

            {/* Success message */}
            <div className="flex items-center gap-2 p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
              <div className="text-sm">
                <span className="font-semibold text-green-700 dark:text-green-300">Conversion complete.</span>
                <span className="text-green-700 dark:text-green-400"> Download the CSV below, then run it through WooSync's normal import flow.</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <Button className="flex-1" size="lg" onClick={download}>
                <Download className="w-4 h-4 mr-2" />
                Download WooCommerce CSV
              </Button>
              <Button variant="outline" size="lg" onClick={reset}>
                Convert Another
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
