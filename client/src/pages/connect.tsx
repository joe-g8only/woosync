import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Link2,
  Store,
  Key,
  Lock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ShieldCheck,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  Trash2,
  Clock,
  Plus,
  ChevronDown,
  ChevronUp,
  User,
  KeyRound,
  ImageIcon,
  Info,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface ConnectResponse {
  sessionId: number;
  storeName?: string;
  storeUrl: string;
}

interface StoreProfile {
  id: number;
  name: string;
  storeUrl: string;
  storeName?: string;
  lastUsedAt?: number;
  createdAt: number;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function ProfileCard({
  profile,
  onConnect,
  onDelete,
  connecting,
}: {
  profile: StoreProfile;
  onConnect: (id: number) => void;
  onDelete: (id: number) => void;
  connecting: boolean;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:border-primary/40 transition-colors group" data-testid={`profile-card-${profile.id}`}>
      <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
        <Store className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate">{profile.name}</div>
        <div className="text-xs text-muted-foreground truncate">{profile.storeUrl}</div>
        {profile.lastUsedAt && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground/70 mt-0.5">
            <Clock className="w-3 h-3" />
            Last used {timeAgo(profile.lastUsedAt)}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="sm"
          className="h-7 px-3 text-xs gap-1.5"
          onClick={() => onConnect(profile.id)}
          disabled={connecting}
          data-testid={`button-connect-profile-${profile.id}`}
        >
          {connecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
          Connect
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => onDelete(profile.id)}
          data-testid={`button-delete-profile-${profile.id}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

export default function ConnectPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [storeUrl, setStoreUrl] = useState("");
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
  const [wpUsername, setWpUsername] = useState("");
  const [wpAppPassword, setWpAppPassword] = useState("");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [connected, setConnected] = useState<ConnectResponse | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [connectingProfileId, setConnectingProfileId] = useState<number | null>(null);

  // Save profile dialog
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [pendingConnect, setPendingConnect] = useState<ConnectResponse | null>(null);

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // Fetch saved profiles
  const { data: profiles = [] } = useQuery<StoreProfile[]>({
    queryKey: ["/api/profiles"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/profiles");
      return res.json();
    },
  });

  const hasProfiles = profiles.length > 0;

  // Connect with credentials
  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/connect", { storeUrl, consumerKey, consumerSecret, wpUsername: wpUsername || undefined, wpAppPassword: wpAppPassword || undefined, openaiApiKey: openaiApiKey || undefined });
      return res.json() as Promise<ConnectResponse>;
    },
    onSuccess: (data) => {
      // Offer to save as profile
      setPendingConnect(data);
      setProfileName(data.storeName || new URL(data.storeUrl).hostname);
      setSaveDialogOpen(true);
    },
  });

  // Save profile
  const saveProfileMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/profiles", {
        name,
        storeUrl,
        consumerKey,
        consumerSecret,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/profiles"] });
      toast({ title: "Profile saved", description: "One-click connect is ready for this store." });
    },
    onError: () => {
      // Profile save failed silently — connection still works
    },
  });

  // Connect from profile (one-click)
  const connectFromProfile = async (profileId: number) => {
    setConnectingProfileId(profileId);
    try {
      const res = await apiRequest("POST", `/api/profiles/${profileId}/connect`, {});
      const data = await res.json();
      setConnected(data);
    } catch (e: any) {
      toast({ title: "Connection failed", description: e.message || "Could not connect with saved credentials.", variant: "destructive" });
    } finally {
      setConnectingProfileId(null);
    }
  };

  // Delete profile
  const deleteProfileMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/profiles/${id}`, undefined);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/profiles"] });
      setDeleteId(null);
      toast({ title: "Profile removed" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    connectMutation.mutate();
  };

  const handleSaveProfile = () => {
    if (profileName.trim()) saveProfileMutation.mutate(profileName.trim());
    setSaveDialogOpen(false);
    setConnected(pendingConnect);
  };

  const handleSkipSave = () => {
    setSaveDialogOpen(false);
    setConnected(pendingConnect);
  };

  // ── Connected success state ────────────────────────────────────────────────
  if (connected) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto px-6 py-16">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 mb-5">
              <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <h1 className="text-xl font-semibold text-foreground mb-2">Connected Successfully</h1>
            <p className="text-muted-foreground text-sm">
              Your WooCommerce store is reachable and authenticated.
            </p>
          </div>

          <Card className="mb-6 border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10">
            <CardContent className="pt-5 pb-5">
              <div className="flex items-start gap-3">
                <Store className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium text-foreground text-sm">
                    {connected.storeName || "WooCommerce Store"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{connected.storeUrl}</div>
                </div>
                <Badge
                  variant="secondary"
                  className="ml-auto shrink-0 text-xs text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/40"
                >
                  Connected
                </Badge>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-3">
            <Button
              size="lg"
              className="w-full gap-2"
              onClick={() => navigate(`/import/${connected.sessionId}`)}
              data-testid="button-continue-to-import"
            >
              Continue to Import
              <ArrowRight className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                setConnected(null);
                setStoreUrl("");
                setConsumerKey("");
                setConsumerSecret("");
              }}
              data-testid="button-disconnect"
            >
              Connect a different store
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  // ── Main connect page ──────────────────────────────────────────────────────
  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-6 py-16">
        {/* Hero */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium mb-5">
            <ShieldCheck className="w-3.5 h-3.5" />
            Session-only credentials — never stored permanently
          </div>
          <h1 className="text-xl font-semibold text-foreground mb-3">Connect Your WooCommerce Store</h1>
          <p className="text-muted-foreground text-sm max-w-md mx-auto leading-relaxed">
            Enter your store credentials to get started. You can find your API keys in{" "}
            <strong>WordPress → WooCommerce → Settings → Advanced → REST API</strong>.
          </p>
        </div>

        {/* Saved profiles */}
        {hasProfiles && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <BookmarkCheck className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-foreground">Saved Stores</span>
              <Badge variant="secondary" className="text-xs ml-auto">{profiles.length}</Badge>
            </div>
            <div className="space-y-2">
              {profiles.map((p) => (
                <ProfileCard
                  key={p.id}
                  profile={p}
                  onConnect={connectFromProfile}
                  onDelete={(id) => setDeleteId(id)}
                  connecting={connectingProfileId === p.id}
                />
              ))}
            </div>
            <div className="relative my-6">
              <Separator />
              <span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-3 text-xs text-muted-foreground">
                or connect manually
              </span>
            </div>
          </div>
        )}

        {/* Manual connect form */}
        {(!hasProfiles || showForm) ? (
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Link2 className="w-4 h-4 text-primary" />
                Store Credentials
              </CardTitle>
              <CardDescription className="text-xs">
                All fields are required. Use a key with Read/Write permissions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="storeUrl" className="text-sm font-medium">
                    Store URL
                  </Label>
                  <div className="relative">
                    <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="storeUrl"
                      data-testid="input-store-url"
                      type="text"
                      placeholder="https://yourstore.com"
                      value={storeUrl}
                      onChange={(e) => setStoreUrl(e.target.value)}
                      className="pl-9"
                      required
                      autoComplete="off"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Your main store domain — no trailing slash needed.</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="consumerKey" className="text-sm font-medium">
                    Consumer Key
                  </Label>
                  <div className="relative">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="consumerKey"
                      data-testid="input-consumer-key"
                      type="text"
                      placeholder="ck_xxxxxxxxxxxxxxxxxxxx"
                      value={consumerKey}
                      onChange={(e) => setConsumerKey(e.target.value)}
                      className="pl-9 font-mono text-sm"
                      required
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="consumerSecret" className="text-sm font-medium">
                    Consumer Secret
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="consumerSecret"
                      data-testid="input-consumer-secret"
                      type="password"
                      placeholder="cs_xxxxxxxxxxxxxxxxxxxx"
                      value={consumerSecret}
                      onChange={(e) => setConsumerSecret(e.target.value)}
                      className="pl-9 font-mono text-sm"
                      required
                      autoComplete="off"
                    />
                  </div>
                </div>

                {/* Optional WP Application Password — needed for image processing */}
                <div className="rounded-lg border border-dashed border-muted-foreground/30 p-3 space-y-3">
                  <div className="flex items-start gap-2">
                    <ImageIcon className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-medium">AI Rewriting (Optional)</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Paste your{" "}
                    <a
                      href="https://platform.openai.com/api-keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
                      OpenAI API key
                    </a>
                    {" "}to power AI description rewrites using your own account. Without this, AI rewriting is unavailable.
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <div className="relative">
                  <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="openaiApiKey"
                    type="password"
                    placeholder="sk-..."
                    value={openaiApiKey}
                    onChange={(e) => setOpenaiApiKey(e.target.value)}
                    className="pl-9 font-mono text-sm"
                    autoComplete="off"
                    data-testid="input-openai-api-key"
                  />
                </div>
              </div>

              {/* Image Processing */}
              <div className="flex items-start gap-3 pt-1">
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                  <ImageIcon className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium">Image Processing (Optional)</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        To upload processed 1000×1000 images directly to your media library, provide your WP admin username and an{" "}
                        <a
                          href="https://wordpress.org/documentation/article/application-passwords/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline"
                        >
                          Application Password
                        </a>
                        . Without this, images are still imported via WooCommerce’s built-in sideloader (no resizing).
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="wpUsername"
                        type="text"
                        placeholder="WP Admin Username"
                        value={wpUsername}
                        onChange={(e) => setWpUsername(e.target.value)}
                        className="pl-9 text-sm"
                        autoComplete="off"
                      />
                    </div>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="wpAppPassword"
                        type="password"
                        placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                        value={wpAppPassword}
                        onChange={(e) => setWpAppPassword(e.target.value)}
                        className="pl-9 font-mono text-sm"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                </div>

                {connectMutation.isError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-sm">
                      {(connectMutation.error as any)?.message ||
                        "Connection failed. Check your credentials and try again."}
                    </AlertDescription>
                  </Alert>
                )}

                <Button
                  type="submit"
                  size="lg"
                  className="w-full gap-2"
                  disabled={connectMutation.isPending}
                  data-testid="button-test-connection"
                >
                  {connectMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Testing Connection...
                    </>
                  ) : (
                    <>
                      <Link2 className="w-4 h-4" />
                      Test Connection
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Button
            variant="outline"
            className="w-full gap-2 border-dashed"
            onClick={() => setShowForm(true)}
            data-testid="button-show-manual-form"
          >
            <Plus className="w-4 h-4" />
            Add a new store manually
          </Button>
        )}

        {/* Helper cards — only when no profiles yet */}
        {!hasProfiles && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
            {[
              {
                icon: ShieldCheck,
                label: "Session Only",
                desc: "Credentials exist only for this browser session.",
              },
              {
                icon: Key,
                label: "Read/Write Keys",
                desc: "API key must have Read/Write permissions.",
              },
              {
                icon: Store,
                label: "WooCommerce v3",
                desc: "Requires WooCommerce REST API v3 enabled.",
              },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-border bg-card p-3.5">
                <item.icon className="w-4 h-4 text-primary mb-2" />
                <div className="text-xs font-medium text-foreground mb-0.5">{item.label}</div>
                <div className="text-xs text-muted-foreground">{item.desc}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save profile dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bookmark className="w-4 h-4 text-primary" />
              Save Store Profile?
            </DialogTitle>
            <DialogDescription className="text-sm">
              Save this store for one-click reconnect next time. Your credentials are stored securely on the server.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="profileName" className="text-sm font-medium">Profile Name</Label>
              <Input
                id="profileName"
                data-testid="input-profile-name"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="e.g. My Main Store"
              />
            </div>
            <div className="rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">
              <div className="font-medium text-foreground mb-0.5">{pendingConnect?.storeName || "WooCommerce Store"}</div>
              <div>{pendingConnect?.storeUrl}</div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={handleSkipSave} data-testid="button-skip-save-profile">
              Skip
            </Button>
            <Button size="sm" onClick={handleSaveProfile} disabled={!profileName.trim()} data-testid="button-save-profile">
              <BookmarkCheck className="w-3.5 h-3.5 mr-1.5" />
              Save Profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove profile?</DialogTitle>
            <DialogDescription className="text-sm">
              This will delete the saved credentials for this store. You can always re-add it later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deleteId !== null && deleteProfileMutation.mutate(deleteId)}
              disabled={deleteProfileMutation.isPending}
              data-testid="button-confirm-delete-profile"
            >
              {deleteProfileMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
