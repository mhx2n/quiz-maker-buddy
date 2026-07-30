/**
 * Where the Express API lives.
 *
 * - Empty (default): same origin — works when the frontend is served by the API
 *   itself, or when the Vite dev proxy forwards `/api` to a local API server.
 * - Set `VITE_API_URL=https://your-api.onrender.com` when the frontend is
 *   hosted separately (Vercel / Cloudflare) from the backend (Render).
 */
export const API_BASE: string = (
  (import.meta.env.VITE_API_URL as string | undefined) ?? ""
).replace(/\/+$/, "");

/** Build an absolute (or same-origin) URL for an `/api/...` path. */
export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${p}`;
}
