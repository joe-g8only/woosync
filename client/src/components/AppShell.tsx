import { useTheme } from "@/components/ThemeProvider";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* SVG Logo */}
            <svg
              aria-label="Woo Sync"
              viewBox="0 0 32 32"
              fill="none"
              className="w-7 h-7 shrink-0"
            >
              <rect width="32" height="32" rx="8" fill="hsl(var(--primary))" />
              <path
                d="M7 16a9 9 0 0 1 9-9"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <path
                d="M25 16a9 9 0 0 1-9 9"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <path
                d="M16 7l2.5 3-2.5 1.5"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M16 25l-2.5-3 2.5-1.5"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="16" cy="16" r="3" fill="white" />
            </svg>
            <div>
              <span className="font-semibold text-sm tracking-tight text-foreground">WooSync</span>
              <span className="ml-2 text-xs text-muted-foreground hidden sm:inline">Product Update Tool</span>
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            data-testid="button-theme-toggle"
            className="text-muted-foreground hover:text-foreground"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border py-4">
        <div className="max-w-6xl mx-auto px-6 text-center text-xs text-muted-foreground">
          WooSync — Credentials are session-only and never stored permanently.
        </div>
      </footer>
    </div>
  );
}
