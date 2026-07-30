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

export type AdminStats = {
  totalUsers: number;
  blockedUsers: number;
  admins: number;
  totalQuizzes: number;
  totalQuestions: number;
  postedToTelegram: number;
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
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

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
  register: (body: { email: string; password: string; name?: string }) =>
    request<{ token: string; user: AuthUser }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  login: (body: { email: string; password: string }) =>
    request<{ token: string; user: AuthUser }>("/auth/login", {
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
};
