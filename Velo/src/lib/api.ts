/**
 * Thin fetch helper that attaches the SIWE upload-session bearer token.
 *
 * Centralises two things callers used to inline:
 *   - the `${BASE_URL}/api` prefix (vite serves the web app behind a
 *     per-artifact base path proxy)
 *   - the `Authorization: Bearer …` header sourced from
 *     `ensureUploadSession()` (which itself ensures the wallet has signed a
 *     fresh SIWE message and caches the resulting HMAC token).
 *
 * Use `apiFetch` for unauthenticated requests and `apiAuthFetch` for
 * routes that require `verifySession()` on the server.
 */
import { ensureUploadSession } from "@/lib/web3/uploader";

export const API_BASE =
  (import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/api";

/** Build a fully-qualified URL for an API path (e.g. `/account`). */
export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path.replace(/^\/api/, "") : `/${path}`;
  return `${API_BASE}${p}`;
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), init);
}

export async function apiAuthFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { token } = await ensureUploadSession();
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(apiUrl(path), { ...init, headers });
}
