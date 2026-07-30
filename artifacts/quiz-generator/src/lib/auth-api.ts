export type AuthUser = {
  id: number;
  email: string;
  name: string;
  role: "user" | "admin" | string;
  isBlocked: boolean;
  quizLimit: number;
  createdAt: string;
  lastLoginAt: string | null;
};

export type AdminUser = AuthUser & { quizCount: number };

export type AdminQuiz = {
  id: number;
  title: string;
  questionCount: number;
  postedToTelegram: boolean;
  createdAt: string;
  userId: number | null;
  ownerEmail: string | null;
};

export type BackupInfo = {
  ok: boolean;
  counts: Record<string, number>;
  detail?: string;
  at: string | null;
} | null;

export type AdminStats = {
  totalUsers: number;
  blockedUsers: number;
  admins: number;
  totalQuizzes: number;
  totalQuestions: number;
  postedToTelegram: number;
  apiKeys: number;
  activeApiKeys: number;
  exhaustedApiKeys: number;
  errorCount: number;
  lastBackup: BackupInfo;
};

export type PlatformSettings = {
  errorBotToken: string;
  errorGroupId: string;
  ownerTelegramIds: string;
  defaultBotToken: string;
  defaultChannelId: string;
  requireAccessCode: boolean;
  mongoUri: string;
  mongoBackupEnabled: boolean;
  notifyOnError: boolean;
  aiTimeoutMs: number;
  hasErrorBotToken: boolean;
  hasDefaultBotToken: boolean;
  hasMongoUri: boolean;
};

export type ProviderInfo = { id: string; label: string; defaultModel: string; vision: boolean };

export type ApiKeyRecord = {
  id: number;
  provider: string;
  label: string;
  apiKey: string;
  model: string | null;
  baseUrl: string | null;
  priority: number;
  isActive: boolean;
  status: string;
  lastError: string | null;
  successCount: number;
  failCount: number;
  lastUsedAt: string | null;
  cooldownUntil: string | null;
  createdAt: string;
};

export type AccessCode = {
  id: number;
  code: string;
  note: string;
  issuedBy: string;
  telegramUserId: string | null;
  usedByUserId: number | null;
  maxUses: number;
  useCount: number;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
  usedAt: string | null;
};

export type ErrorLog = {
  id: number;
  source: string;
  level: string;
  message: string;
  stack: string | null;
  context: Record<string, unknown> | null;
  userId: number | null;
  notified: boolean;
  createdAt: string;
};

const TOKEN_KEY = "quizgen_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api${path}`), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new Error(API_UNREACHABLE);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  // A 404 that returns HTML means we hit the static frontend, not the API.
  const looksLikeHtml = text.trimStart().startsWith("<");
  if (!res.ok && (res.status === 404 || res.status === 502) && looksLikeHtml) {
    throw new Error(API_UNREACHABLE);
  }

  let data: unknown = null;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    if (!res.ok) throw new Error(API_UNREACHABLE);
    throw new Error("Unexpected response from the server.");
  }

  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(message);
  }

  return data as T;
}


// ── Auth ───────────────────────────────────────────────────────────────────
export const authApi = {
  config: () => request<{ requireAccessCode: boolean; firstRun: boolean }>("/auth/config"),
  register: (body: { email: string; password: string; name?: string; accessCode?: string }) =>
    request<{ token: string; user: AuthUser }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  login: (body: { email: string; password: string }) =>
    request<{ token: string; user: AuthUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  adminLogin: (body: { email: string; password: string }) =>
    request<{ token: string; user: AuthUser }>("/auth/admin-login", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  me: () => request<{ user: AuthUser }>("/auth/me"),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    request<{ success: boolean }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

// ── Admin ──────────────────────────────────────────────────────────────────
export const adminApi = {
  stats: () => request<AdminStats>("/admin/stats"),
  users: () => request<AdminUser[]>("/admin/users"),
  updateUser: (
    id: number,
    body: Partial<{ role: string; isBlocked: boolean; quizLimit: number; name: string; newPassword: string }>,
  ) => request<AuthUser>(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteUser: (id: number) => request<void>(`/admin/users/${id}`, { method: "DELETE" }),
  quizzes: () => request<AdminQuiz[]>("/admin/quizzes"),
  deleteQuiz: (id: number) => request<void>(`/admin/quizzes/${id}`, { method: "DELETE" }),

  settings: () => request<PlatformSettings>("/admin/settings"),
  saveSettings: (body: Partial<PlatformSettings>) =>
    request<PlatformSettings>("/admin/settings", { method: "PUT", body: JSON.stringify(body) }),
  testTelegram: () =>
    request<{ ok: boolean; error?: string }>("/admin/settings/test-telegram", { method: "POST" }),

  providers: () => request<ProviderInfo[]>("/admin/providers"),
  apiKeys: () => request<ApiKeyRecord[]>("/admin/api-keys"),
  addApiKey: (body: {
    provider: string;
    apiKey: string;
    label?: string;
    model?: string | null;
    baseUrl?: string | null;
    priority?: number;
  }) => request<ApiKeyRecord>("/admin/api-keys", { method: "POST", body: JSON.stringify(body) }),
  updateApiKey: (id: number, body: Partial<{ isActive: boolean; priority: number; model: string; label: string }>) =>
    request<ApiKeyRecord>(`/admin/api-keys/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteApiKey: (id: number) => request<void>(`/admin/api-keys/${id}`, { method: "DELETE" }),
  testApiKey: (id: number) =>
    request<{ ok: boolean; detail: string }>(`/admin/api-keys/${id}/test`, { method: "POST" }),

  accessCodes: () => request<AccessCode[]>("/admin/access-codes"),
  createAccessCodes: (body: { note?: string; count?: number; maxUses?: number }) =>
    request<AccessCode[]>("/admin/access-codes", { method: "POST", body: JSON.stringify(body) }),
  setAccessCodeActive: (id: number, isActive: boolean) =>
    request<AccessCode>(`/admin/access-codes/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
  deleteAccessCode: (id: number) => request<void>(`/admin/access-codes/${id}`, { method: "DELETE" }),

  errors: (limit = 50) => request<ErrorLog[]>(`/admin/errors?limit=${limit}`),
  clearErrors: () => request<void>("/admin/errors", { method: "DELETE" }),

  runBackup: () => request<NonNullable<BackupInfo>>("/admin/backup", { method: "POST" }),
};

/** Fire-and-forget client error reporting → private Telegram group. */
export function reportClientError(payload: {
  message: string;
  stack?: string | null;
  kind?: string;
  extra?: Record<string, unknown>;
}) {
  try {
    void fetch("/api/client-errors", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: JSON.stringify({ ...payload, url: window.location.href }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never let reporting break the app */
  }
}
