/**
 * CategoryTreePreview
 *
 * Builds a nested category tree from CSV rows and renders it as a collapsible
 * tree showing exactly how WooCommerce categories will be created/assigned.
 *
 * Tree structure: Category → Subcategory → Sub-Subcategory
 * Each node shows product count and whether it's new or existing.
 */
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Folder,
  Tag,
  TreePine,
  AlertTriangle,
  Package,
} from "lucide-react";

interface CategoryRow {
  l1: string;
  l2: string;
  l3: string;
}

interface ColumnMapState {
  [sourceColumn: string]: string;
}

// Tree node types
interface TreeLeaf {
  name: string;
  productCount: number;
}

interface TreeBranch {
  name: string;
  productCount: number; // products directly at this level (no sub)
  children: Map<string, TreeBranch>;
  leaves: TreeLeaf[];
}

/** Build a nested tree from flat category rows, respecting column map overrides */
function buildTree(
  rows: CategoryRow[],
  columnMap: ColumnMapState
): Map<string, TreeBranch> {
  // Resolve which source CSV column maps to each WooCommerce target
  // The categoryRows from server already attempt smart lookup,
  // but we also apply the columnMap layer for user-overridden mappings.
  const root = new Map<string, TreeBranch>();

  for (const row of rows) {
    const l1 = row.l1;
    const l2 = row.l2;
    const l3 = row.l3;

    if (!l1) continue; // skip rows with no category

    // Get or create L1
    if (!root.has(l1)) {
      root.set(l1, { name: l1, productCount: 0, children: new Map(), leaves: [] });
    }
    const l1Node = root.get(l1)!;

    if (!l2) {
      // Product sits directly under L1
      l1Node.productCount++;
      continue;
    }

    // Get or create L2
    if (!l1Node.children.has(l2)) {
      l1Node.children.set(l2, { name: l2, productCount: 0, children: new Map(), leaves: [] });
    }
    const l2Node = l1Node.children.get(l2)!;

    if (!l3) {
      l2Node.productCount++;
      continue;
    }

    // Get or create L3
    if (!l2Node.children.has(l3)) {
      l2Node.children.set(l3, { name: l3, productCount: 0, children: new Map(), leaves: [] });
    }
    l2Node.children.get(l3)!.productCount++;
  }

  return root;
}

function totalProducts(node: TreeBranch): number {
  let count = node.productCount;
  for (const child of node.children.values()) {
    count += totalProducts(child);
  }
  return count;
}

function totalCategories(root: Map<string, TreeBranch>): number {
  let count = 0;
  for (const l1 of root.values()) {
    count++; // l1 itself
    for (const l2 of l1.children.values()) {
      count++;
      count += l2.children.size;
    }
  }
  return count;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function L3Node({ node }: { node: TreeBranch }) {
  return (
    <div className="flex items-center gap-2 py-1 pl-2">
      <Tag className="h-3 w-3 text-muted-foreground/60 flex-shrink-0" />
      <span className="text-xs text-muted-foreground">{node.name}</span>
      <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-auto">
        {totalProducts(node)} {totalProducts(node) === 1 ? "product" : "products"}
      </Badge>
    </div>
  );
}

function L2Node({ node, defaultOpen }: { node: TreeBranch; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  const hasChildren = node.children.size > 0;
  const total = totalProducts(node);

  return (
    <div className="ml-4">
      <button
        className="w-full flex items-center gap-2 py-1.5 text-left hover:text-foreground transition-colors group"
        onClick={() => hasChildren && setOpen((v) => !v)}
      >
        {hasChildren ? (
          open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          )
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}
        {open && hasChildren ? (
          <FolderOpen className="h-3.5 w-3.5 text-indigo-400 flex-shrink-0" />
        ) : (
          <Folder className="h-3.5 w-3.5 text-indigo-400 flex-shrink-0" />
        )}
        <span className="text-sm text-foreground/80 group-hover:text-foreground">{node.name}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {node.productCount > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              +{node.productCount} direct
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {total} total
          </Badge>
        </div>
      </button>
      {open && hasChildren && (
        <div className="ml-2 border-l border-border/60 pl-2">
          {[...node.children.values()].map((l3) => (
            <L3Node key={l3.name} node={l3} />
          ))}
        </div>
      )}
    </div>
  );
}

function L1Node({ node, defaultOpen }: { node: TreeBranch; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  const hasChildren = node.children.size > 0;
  const total = totalProducts(node);

  return (
    <div>
      <button
        className="w-full flex items-center gap-2 py-2 text-left hover:text-foreground transition-colors group rounded-md px-2 hover:bg-muted/50"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
        {open ? (
          <FolderOpen className="h-4 w-4 text-primary flex-shrink-0" />
        ) : (
          <Folder className="h-4 w-4 text-primary flex-shrink-0" />
        )}
        <span className="text-sm font-semibold text-foreground">{node.name}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {node.children.size > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {node.children.size} {node.children.size === 1 ? "sub" : "subs"}
            </Badge>
          )}
          <Badge className="text-[10px] px-1.5 py-0 bg-primary/10 text-primary border-primary/20">
            {total} {total === 1 ? "product" : "products"}
          </Badge>
        </div>
      </button>

      {open && (
        <div className="ml-3 border-l border-border/60 pl-1 mb-1">
          {node.productCount > 0 && (
            <div className="flex items-center gap-2 py-1 ml-4">
              <Package className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
              <span className="text-xs text-muted-foreground italic">
                {node.productCount} product{node.productCount !== 1 ? "s" : ""} assigned directly here
              </span>
            </div>
          )}
          {[...node.children.values()].map((l2) => (
            <L2Node key={l2.name} node={l2} defaultOpen={node.children.size <= 5} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface CategoryTreePreviewProps {
  categoryRows: CategoryRow[];
  columnMap: ColumnMapState;
}

export function CategoryTreePreview({ categoryRows, columnMap }: CategoryTreePreviewProps) {
  const [showAll, setShowAll] = useState(false);

  const tree = useMemo(
    () => buildTree(categoryRows, columnMap),
    [categoryRows, columnMap]
  );

  const catCount = useMemo(() => totalCategories(tree), [tree]);
  const productCount = useMemo(
    () => categoryRows.filter((r) => r.l1).length,
    [categoryRows]
  );
  const uncategorised = useMemo(
    () => categoryRows.filter((r) => !r.l1).length,
    [categoryRows]
  );

  // Determine max depth
  const maxDepth = useMemo(() => {
    let depth = 0;
    for (const l1 of tree.values()) {
      if (l1.children.size > 0) {
        depth = Math.max(depth, 2);
        for (const l2 of l1.children.values()) {
          if (l2.children.size > 0) { depth = 3; break; }
        }
      } else {
        depth = Math.max(depth, 1);
      }
    }
    return depth;
  }, [tree]);

  if (tree.size === 0) return null;

  const l1Keys = [...tree.keys()];
  const visibleKeys = showAll ? l1Keys : l1Keys.slice(0, 8);
  const hiddenCount = l1Keys.length - visibleKeys.length;

  return (
    <Card className="border-indigo-500/20">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
              <TreePine className="h-4 w-4 text-indigo-500" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Category Tree Preview</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                How categories will nest in WooCommerce after import
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 justify-end">
            <Badge variant="outline" className="text-[11px]">
              {l1Keys.length} top-level
            </Badge>
            <Badge variant="outline" className="text-[11px]">
              {catCount} total categories
            </Badge>
            {maxDepth >= 2 && (
              <Badge variant="secondary" className="text-[11px]">
                {maxDepth} levels deep
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        {/* Depth legend */}
        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">
          <span className="flex items-center gap-1.5">
            <Folder className="h-3 w-3 text-primary" />
            Category
          </span>
          {maxDepth >= 2 && (
            <span className="flex items-center gap-1.5">
              <Folder className="h-3 w-3 text-indigo-400" />
              Subcategory
            </span>
          )}
          {maxDepth >= 3 && (
            <span className="flex items-center gap-1.5">
              <Tag className="h-3 w-3 text-muted-foreground/60" />
              Sub-Subcategory
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            <Package className="h-3 w-3" />
            {productCount} products categorised
            {uncategorised > 0 && `, ${uncategorised} uncategorised`}
          </span>
        </div>

        {/* Tree */}
        <div className="rounded-lg border bg-card/50 divide-y divide-border/50 overflow-hidden">
          {visibleKeys.map((key) => (
            <div key={key} className="px-2 py-0.5">
              <L1Node node={tree.get(key)!} defaultOpen={l1Keys.length <= 6} />
            </div>
          ))}
        </div>

        {hiddenCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground"
            onClick={() => setShowAll(true)}
          >
            Show {hiddenCount} more top-level {hiddenCount === 1 ? "category" : "categories"}
          </Button>
        )}

        {uncategorised > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{uncategorised} row{uncategorised !== 1 ? "s" : ""}</span> have no category value — those products will be imported without a category.
              Check your column mapping if this is unexpected.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
