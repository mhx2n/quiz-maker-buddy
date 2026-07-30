import { useEffect, useState } from "react";
import {
  Loader2,
  ShieldCheck,
  Trash2,
  Users,
  FileText,
  Send,
  Ban,
  KeyRound,
  Ticket,
  Bug,
  Settings2,
  DatabaseBackup,
  Plus,
  RefreshCw,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import {
  adminApi,
  type AccessCode,
  type AdminQuiz,
  type AdminStats,
  type AdminUser,
  type ApiKeyRecord,
  type ErrorLog,
  type PlatformSettings,
  type ProviderInfo,
} from "@/lib/auth-api";

function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Users }) {
  return (
    <Card>
      <CardContent className="pt-6 flex items-center gap-3">
        <div className="w-9 h-9 rounded-md bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <div className="text-2xl font-bold leading-none">{value}</div>
          <div className="text-xs text-muted-foreground mt-1">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "ok") return "default";
  if (status === "exhausted") return "destructive";
  if (status === "error") return "destructive";
  return "secondary";
}

export default function AdminPage() {
  const { user, isAdmin, loading } = useAuth();
  const { toast } = useToast();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [quizzes, setQuizzes] = useState<AdminQuiz[]>([]);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
  const [codes, setCodes] = useState<AccessCode[]>([]);
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);

  const [newKey, setNewKey] = useState({
    provider: "gemini",
    apiKey: "",
    label: "",
    model: "",
    baseUrl: "",
    priority: 100,
  });
  const [codeForm, setCodeForm] = useState({ note: "", count: 1, maxUses: 1 });

  function fail(title: string) {
    return (err: unknown) =>
      toast({
        title,
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
  }

  async function refresh() {
    setBusy(true);
    try {
      const [s, u, q, st, pr, ak, ac, er] = await Promise.all([
        adminApi.stats(),
        adminApi.users(),
        adminApi.quizzes(),
        adminApi.settings(),
        adminApi.providers(),
        adminApi.apiKeys(),
        adminApi.accessCodes(),
        adminApi.errors(50),
      ]);
      setStats(s);
      setUsers(u);
      setQuizzes(q);
      setSettings(st);
      setProviders(pr);
      setApiKeys(ak);
      setCodes(ac);
      setErrors(er);
    } catch (err) {
      fail("Could not load admin data")(err);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (isAdmin) void refresh();
    else setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function patch(id: number, body: Parameters<typeof adminApi.updateUser>[1]) {
    try {
      await adminApi.updateUser(id, body);
      await refresh();
    } catch (err) {
      fail("Update failed")(err);
    }
  }

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    try {
      const saved = await adminApi.saveSettings(settings);
      setSettings(saved);
      toast({ title: "Settings saved" });
    } catch (err) {
      fail("Could not save settings")(err);
    } finally {
      setSaving(false);
    }
  }

  if (loading || busy) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Hidden route: non-admins get nothing useful.
  if (!user || !isAdmin) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-2">
        <h1 className="text-2xl font-bold">404</h1>
        <p className="text-muted-foreground text-sm">This page does not exist.</p>
      </div>
    );
  }

  const set = <K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) =>
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Admin Panel</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          <StatCard label="Users" value={stats.totalUsers} icon={Users} />
          <StatCard label="Blocked" value={stats.blockedUsers} icon={Ban} />
          <StatCard label="Quizzes" value={stats.totalQuizzes} icon={FileText} />
          <StatCard label="Posted" value={stats.postedToTelegram} icon={Send} />
          <StatCard label="Active keys" value={stats.activeApiKeys} icon={KeyRound} />
          <StatCard label="Errors" value={stats.errorCount} icon={Bug} />
        </div>
      )}

      <Tabs defaultValue="users">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="quizzes">Quizzes</TabsTrigger>
          <TabsTrigger value="keys">AI keys</TabsTrigger>
          <TabsTrigger value="codes">Access codes</TabsTrigger>
          <TabsTrigger value="errors">Errors</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* ── Users ─────────────────────────────────────────────── */}
        <TabsContent value="users" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Users</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4 font-medium">User</th>
                    <th className="py-2 pr-4 font-medium">Role</th>
                    <th className="py-2 pr-4 font-medium">Quizzes</th>
                    <th className="py-2 pr-4 font-medium">Limit (0 = ∞)</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b last:border-0">
                      <td className="py-3 pr-4">
                        <div className="font-medium">{u.name || u.email}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={u.role === "admin" ? "default" : "secondary"}>{u.role}</Badge>
                      </td>
                      <td className="py-3 pr-4">{u.quizCount}</td>
                      <td className="py-3 pr-4">
                        <Input
                          type="number"
                          min={0}
                          defaultValue={u.quizLimit}
                          className="h-8 w-24"
                          onBlur={(e) => {
                            const next = Number(e.target.value);
                            if (!Number.isNaN(next) && next !== u.quizLimit) void patch(u.id, { quizLimit: next });
                          }}
                        />
                      </td>
                      <td className="py-3 pr-4">
                        {u.isBlocked ? (
                          <Badge variant="destructive">Blocked</Badge>
                        ) : (
                          <Badge variant="outline">Active</Badge>
                        )}
                      </td>
                      <td className="py-3 text-right space-x-2 whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={u.id === user.id}
                          onClick={() => void patch(u.id, { isBlocked: !u.isBlocked })}
                        >
                          {u.isBlocked ? "Unblock" : "Block"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={u.id === user.id}
                          onClick={() => void patch(u.id, { role: u.role === "admin" ? "user" : "admin" })}
                        >
                          {u.role === "admin" ? "Make user" : "Make admin"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={u.id === user.id}
                          onClick={async () => {
                            if (!confirm(`Delete ${u.email} and all their quizzes?`)) return;
                            await adminApi.deleteUser(u.id).catch(fail("Delete failed"));
                            await refresh();
                          }}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Quizzes ───────────────────────────────────────────── */}
        <TabsContent value="quizzes" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">All quizzes</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4 font-medium">Title</th>
                    <th className="py-2 pr-4 font-medium">Owner</th>
                    <th className="py-2 pr-4 font-medium">Questions</th>
                    <th className="py-2 pr-4 font-medium">Telegram</th>
                    <th className="py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {quizzes.map((q) => (
                    <tr key={q.id} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-medium">{q.title}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{q.ownerEmail ?? "—"}</td>
                      <td className="py-3 pr-4">{q.questionCount}</td>
                      <td className="py-3 pr-4">{q.postedToTelegram ? "Posted" : "—"}</td>
                      <td className="py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            if (!confirm("Delete this quiz?")) return;
                            await adminApi.deleteQuiz(q.id).catch(fail("Delete failed"));
                            await refresh();
                          }}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── AI keys ───────────────────────────────────────────── */}
        <TabsContent value="keys" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add an AI provider key</CardTitle>
              <CardDescription>
                Keys are used in priority order with automatic failover. When one runs out of quota the next one
                takes over and the owner group gets a Telegram alert.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-6">
              <div className="space-y-2 md:col-span-1">
                <Label>Provider</Label>
                <Select value={newKey.provider} onValueChange={(v) => setNewKey({ ...newKey, provider: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>API key</Label>
                <Input
                  value={newKey.apiKey}
                  onChange={(e) => setNewKey({ ...newKey, apiKey: e.target.value })}
                  placeholder="paste key"
                  type="password"
                />
              </div>
              <div className="space-y-2">
                <Label>Model (optional)</Label>
                <Input
                  value={newKey.model}
                  onChange={(e) => setNewKey({ ...newKey, model: e.target.value })}
                  placeholder={providers.find((p) => p.id === newKey.provider)?.defaultModel ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label>Label</Label>
                <Input
                  value={newKey.label}
                  onChange={(e) => setNewKey({ ...newKey, label: e.target.value })}
                  placeholder="e.g. main"
                />
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Input
                  type="number"
                  value={newKey.priority}
                  onChange={(e) => setNewKey({ ...newKey, priority: Number(e.target.value) })}
                />
              </div>
              {newKey.provider === "custom" && (
                <div className="space-y-2 md:col-span-3">
                  <Label>Base URL</Label>
                  <Input
                    value={newKey.baseUrl}
                    onChange={(e) => setNewKey({ ...newKey, baseUrl: e.target.value })}
                    placeholder="https://api.example.com/v1"
                  />
                </div>
              )}
              <div className="md:col-span-6">
                <Button
                  disabled={!newKey.apiKey.trim()}
                  onClick={async () => {
                    try {
                      await adminApi.addApiKey({
                        provider: newKey.provider,
                        apiKey: newKey.apiKey.trim(),
                        label: newKey.label.trim(),
                        model: newKey.model.trim() || null,
                        baseUrl: newKey.baseUrl.trim() || null,
                        priority: newKey.priority,
                      });
                      setNewKey({ ...newKey, apiKey: "", label: "", model: "", baseUrl: "" });
                      await refresh();
                      toast({ title: "API key added" });
                    } catch (err) {
                      fail("Could not add key")(err);
                    }
                  }}
                >
                  <Plus className="w-4 h-4 mr-2" /> Add key
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Configured keys ({apiKeys.length})</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4 font-medium">Provider</th>
                    <th className="py-2 pr-4 font-medium">Key</th>
                    <th className="py-2 pr-4 font-medium">Model</th>
                    <th className="py-2 pr-4 font-medium">Priority</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Usage</th>
                    <th className="py-2 pr-4 font-medium">Enabled</th>
                    <th className="py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {apiKeys.map((k) => (
                    <tr key={k.id} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-medium">
                        {providers.find((p) => p.id === k.provider)?.label ?? k.provider}
                        {k.label && <div className="text-xs text-muted-foreground">{k.label}</div>}
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs">{k.apiKey}</td>
                      <td className="py-3 pr-4 text-xs">{k.model ?? "default"}</td>
                      <td className="py-3 pr-4">
                        <Input
                          type="number"
                          defaultValue={k.priority}
                          className="h-8 w-20"
                          onBlur={(e) => {
                            const next = Number(e.target.value);
                            if (next !== k.priority)
                              void adminApi.updateApiKey(k.id, { priority: next }).then(refresh).catch(fail("Update failed"));
                          }}
                        />
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={statusVariant(k.status)}>{k.status}</Badge>
                        {k.lastError && (
                          <div className="text-xs text-muted-foreground max-w-[220px] truncate">{k.lastError}</div>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-xs whitespace-nowrap">
                        ✓ {k.successCount} · ✕ {k.failCount}
                      </td>
                      <td className="py-3 pr-4">
                        <Switch
                          checked={k.isActive}
                          onCheckedChange={(v) =>
                            void adminApi.updateApiKey(k.id, { isActive: v }).then(refresh).catch(fail("Update failed"))
                          }
                        />
                      </td>
                      <td className="py-3 text-right space-x-2 whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            const r = await adminApi.testApiKey(k.id).catch((e) => {
                              fail("Test failed")(e);
                              return null;
                            });
                            if (r) toast({ title: r.ok ? "Key works" : "Key failed", description: r.detail });
                            await refresh();
                          }}
                        >
                          Test
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            if (!confirm("Delete this key?")) return;
                            await adminApi.deleteApiKey(k.id).catch(fail("Delete failed"));
                            await refresh();
                          }}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!apiKeys.length && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-muted-foreground">
                        No AI keys yet. Add at least one so quiz generation works.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Access codes ──────────────────────────────────────── */}
        <TabsContent value="codes" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Issue access codes</CardTitle>
              <CardDescription>
                Users need a code to register. Codes can also be generated from Telegram with <code>/newcode</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2 md:col-span-2">
                <Label>Note</Label>
                <Input
                  value={codeForm.note}
                  onChange={(e) => setCodeForm({ ...codeForm, note: e.target.value })}
                  placeholder="who is this for?"
                />
              </div>
              <div className="space-y-2">
                <Label>How many</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={codeForm.count}
                  onChange={(e) => setCodeForm({ ...codeForm, count: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Uses per code</Label>
                <Input
                  type="number"
                  min={1}
                  value={codeForm.maxUses}
                  onChange={(e) => setCodeForm({ ...codeForm, maxUses: Number(e.target.value) })}
                />
              </div>
              <div className="md:col-span-4">
                <Button
                  onClick={async () => {
                    try {
                      await adminApi.createAccessCodes(codeForm);
                      await refresh();
                      toast({ title: "Codes generated" });
                    } catch (err) {
                      fail("Could not generate codes")(err);
                    }
                  }}
                >
                  <Ticket className="w-4 h-4 mr-2" /> Generate
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Codes ({codes.length})</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4 font-medium">Code</th>
                    <th className="py-2 pr-4 font-medium">Note</th>
                    <th className="py-2 pr-4 font-medium">Issued by</th>
                    <th className="py-2 pr-4 font-medium">Uses</th>
                    <th className="py-2 pr-4 font-medium">Active</th>
                    <th className="py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-mono">{c.code}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{c.note || "—"}</td>
                      <td className="py-3 pr-4 text-xs">{c.issuedBy}</td>
                      <td className="py-3 pr-4">
                        {c.useCount}/{c.maxUses}
                      </td>
                      <td className="py-3 pr-4">
                        <Switch
                          checked={c.isActive}
                          onCheckedChange={(v) =>
                            void adminApi.setAccessCodeActive(c.id, v).then(refresh).catch(fail("Update failed"))
                          }
                        />
                      </td>
                      <td className="py-3 text-right space-x-2 whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void navigator.clipboard?.writeText(c.code);
                            toast({ title: "Code copied" });
                          }}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            if (!confirm("Delete this code?")) return;
                            await adminApi.deleteAccessCode(c.id).catch(fail("Delete failed"));
                            await refresh();
                          }}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!codes.length && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-muted-foreground">
                        No codes yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Errors ────────────────────────────────────────────── */}
        <TabsContent value="errors" className="mt-6">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Recent errors</CardTitle>
                <CardDescription>Also delivered live to the private Telegram group.</CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  if (!confirm("Clear the error log?")) return;
                  await adminApi.clearErrors().catch(fail("Clear failed"));
                  await refresh();
                }}
              >
                Clear
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {errors.map((e) => (
                <div key={e.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={e.level === "error" ? "destructive" : "secondary"}>{e.level}</Badge>
                    <Badge variant="outline">{e.source}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-2 font-medium break-words">{e.message}</p>
                  {e.stack && (
                    <pre className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap max-h-32 overflow-auto">
                      {e.stack}
                    </pre>
                  )}
                </div>
              ))}
              {!errors.length && (
                <p className="py-6 text-center text-muted-foreground text-sm">No errors recorded. 🎉</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Settings ──────────────────────────────────────────── */}
        <TabsContent value="settings" className="mt-6 space-y-6">
          {settings && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Settings2 className="w-4 h-4" /> Telegram monitoring bot
                  </CardTitle>
                  <CardDescription>
                    Add this bot to your private group as an admin, then paste the group ID (starts with -100).
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Error bot token</Label>
                    <Input
                      type="password"
                      value={settings.errorBotToken}
                      onChange={(e) => set("errorBotToken", e.target.value)}
                      placeholder={settings.hasErrorBotToken ? "•••••• (saved)" : "123456:ABC..."}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Private group ID</Label>
                    <Input
                      value={settings.errorGroupId}
                      onChange={(e) => set("errorGroupId", e.target.value)}
                      placeholder="-1001234567890"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Owner Telegram user IDs (comma separated)</Label>
                    <Input
                      value={settings.ownerTelegramIds}
                      onChange={(e) => set("ownerTelegramIds", e.target.value)}
                      placeholder="12345678, 87654321"
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <Label>Send error notifications</Label>
                      <p className="text-xs text-muted-foreground">Live alerts for every failure.</p>
                    </div>
                    <Switch
                      checked={settings.notifyOnError}
                      onCheckedChange={(v) => set("notifyOnError", v)}
                    />
                  </div>
                  <div className="md:col-span-2 flex gap-2">
                    <Button
                      variant="outline"
                      onClick={async () => {
                        const r = await adminApi.testTelegram().catch((e) => {
                          fail("Test failed")(e);
                          return null;
                        });
                        if (r) toast({ title: r.ok ? "Test message sent" : "Failed", description: r.error });
                      }}
                    >
                      <Send className="w-4 h-4 mr-2" /> Send test message
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Default posting bot</CardTitle>
                  <CardDescription>
                    Used when a user does not supply their own bot token. Users can still bring their own.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Default bot token</Label>
                    <Input
                      type="password"
                      value={settings.defaultBotToken}
                      onChange={(e) => set("defaultBotToken", e.target.value)}
                      placeholder={settings.hasDefaultBotToken ? "•••••• (saved)" : "123456:ABC..."}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Default channel</Label>
                    <Input
                      value={settings.defaultChannelId}
                      onChange={(e) => set("defaultChannelId", e.target.value)}
                      placeholder="@mychannel"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <DatabaseBackup className="w-4 h-4" /> MongoDB backup
                  </CardTitle>
                  <CardDescription>
                    Everything is mirrored to MongoDB on a schedule.
                    {stats?.lastBackup?.at && ` Last backup: ${new Date(stats.lastBackup.at).toLocaleString()}`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label>MongoDB connection URI</Label>
                    <Input
                      type="password"
                      value={settings.mongoUri}
                      onChange={(e) => set("mongoUri", e.target.value)}
                      placeholder={settings.hasMongoUri ? "•••••• (saved)" : "mongodb+srv://user:pass@cluster/db"}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <Label>Automatic backups</Label>
                      <p className="text-xs text-muted-foreground">Runs hourly in the background.</p>
                    </div>
                    <Switch
                      checked={settings.mongoBackupEnabled}
                      onCheckedChange={(v) => set("mongoBackupEnabled", v)}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      variant="outline"
                      onClick={async () => {
                        const r = await adminApi.runBackup().catch((e) => {
                          fail("Backup failed")(e);
                          return null;
                        });
                        if (r)
                          toast({
                            title: r.ok ? "Backup complete" : "Backup failed",
                            description: r.ok ? JSON.stringify(r.counts) : r.detail,
                          });
                        await refresh();
                      }}
                    >
                      <DatabaseBackup className="w-4 h-4 mr-2" /> Back up now
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Access control</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <Label>Require access code to register</Label>
                      <p className="text-xs text-muted-foreground">Codes come from the Telegram bot or this panel.</p>
                    </div>
                    <Switch
                      checked={settings.requireAccessCode}
                      onCheckedChange={(v) => set("requireAccessCode", v)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>AI request timeout (ms)</Label>
                    <Input
                      type="number"
                      value={settings.aiTimeoutMs}
                      onChange={(e) => set("aiTimeoutMs", Number(e.target.value))}
                    />
                  </div>
                </CardContent>
              </Card>

              <Button onClick={() => void saveSettings()} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save all settings
              </Button>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
