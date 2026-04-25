import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import ConnectPage from "@/pages/connect";
import ImportPage from "@/pages/import";
import ResultsPage from "@/pages/results";
import ShopifyConvertPage from "@/pages/shopify-convert";
import NotFound from "@/pages/not-found";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Component, type ReactNode } from "react";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-8 bg-background">
          <div className="max-w-md w-full rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10 p-6">
            <h2 className="text-base font-semibold text-red-700 dark:text-red-400 mb-2">Something went wrong</h2>
            <p className="text-xs text-red-600 dark:text-red-300 font-mono whitespace-pre-wrap break-all">
              {(this.state.error as Error).message}
            </p>
            <button
              className="mt-4 px-3 py-1.5 rounded bg-red-600 text-white text-xs font-medium hover:bg-red-700"
              onClick={() => { this.setState({ error: null }); window.location.hash = "/"; }}
            >
              Go back to Connect
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <Router hook={useHashLocation}>
            <Switch>
              <Route path="/" component={ConnectPage} />
              <Route path="/import/:sessionId" component={ImportPage} />
              <Route path="/results/:runId" component={ResultsPage} />
              <Route path="/shopify-convert" component={ShopifyConvertPage} />
              <Route component={NotFound} />
            </Switch>
          </Router>
        </ErrorBoundary>
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
