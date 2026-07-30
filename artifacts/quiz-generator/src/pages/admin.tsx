import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, Trash2, Users, FileText, Send, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { adminApi, type AdminQuiz, type AdminStats, type AdminUser } from "@/lib/auth-api";

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

export default function AdminPage() {
  const { user, isAdmin, loading } = useAuth();
  const { toast } = useToast();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [quizzes, setQuizzes] = useState<AdminQuiz[]>([]);
  const [busy, setBusy] = useState(true);

  async function refresh() {
    setBusy(true);
    try {
      const [s, u, q] = await Promise.all([adminApi.stats(), adminApi.users(), adminApi.quizzes()]);
      setStats(s);
      setUsers(u);
      setQuizzes(q);
    } catch (err) {
      toast({
        title: "Could not load admin data",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
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
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
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

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">Admin Panel</h1>
      </div>

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Users" value={stats.totalUsers} icon={Users} />
          <StatCard label="Blocked users" value={stats.blockedUsers} icon={Ban} />
          <StatCard label="Quizzes" value={stats.totalQuizzes} icon={FileText} />
          <StatCard label="Posted to Telegram" value={stats.postedToTelegram} icon={Send} />
        </div>
      )}

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
                        await adminApi.deleteUser(u.id);
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
                        await adminApi.deleteQuiz(q.id);
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
    </div>
  );
}
