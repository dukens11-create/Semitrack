export type AdminUser = {
  id: string;
  email: string;
  fullName: string;
  role: "ADMIN" | "FLEET_ADMIN" | "MODERATOR" | "DRIVER";
  plan: string;
};

const API_URL = String(import.meta.env.VITE_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = 20_000;
const accessKey = "semitrax.admin.access";
const refreshKey = "semitrax.admin.refresh";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const session = {
  access: () => {
    try { return sessionStorage.getItem(accessKey); } catch { return null; }
  },
  save: (access: string, refresh: string) => {
    try {
      sessionStorage.setItem(accessKey, access);
      sessionStorage.setItem(refreshKey, refresh);
    } catch {
      throw new ApiError(0, "Secure browser storage is unavailable");
    }
  },
  clear: () => {
    try {
      sessionStorage.removeItem(accessKey);
      sessionStorage.removeItem(refreshKey);
    } catch { /* Local sign-out must still complete. */ }
  },
};

function refreshToken() {
  try { return sessionStorage.getItem(refreshKey); } catch { return null; }
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  if (!path.startsWith("/")) throw new ApiError(0, "Invalid API path");
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  const token = session.access();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers, signal: controller.signal });
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "AbortError") {
      throw new ApiError(0, "The SemiTraX server took too long to respond");
    }
    throw new ApiError(0, "Unable to connect to SemiTraX");
  } finally {
    window.clearTimeout(timer);
  }
  if (response.status === 401 && retry && refreshToken()) {
    const refreshed = await refresh();
    if (refreshed) return request<T>(path, init, false);
  }
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.message ?? body?.error ?? "Request failed";
    throw new ApiError(response.status, String(message));
  }
  if (body === null && response.status !== 204) {
    throw new ApiError(response.status, "SemiTraX returned an invalid response");
  }
  return body as T;
}

let refreshInFlight: Promise<boolean> | null = null;

function refresh() {
  return refreshInFlight ??= performRefresh().finally(() => { refreshInFlight = null; });
}

async function performRefresh() {
  const token = refreshToken();
  if (!token) return false;
  let response: Response;
  try {
    response = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refreshToken: token }),
    });
  } catch { return false; }
  if (!response.ok) { session.clear(); return false; }
  const body = await response.json().catch(() => null);
  if (!body || typeof body.accessToken !== "string" || typeof body.refreshToken !== "string") return false;
  session.save(body.accessToken, body.refreshToken);
  return true;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T,>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  login: (email: string, password: string) => request<{ accessToken: string; refreshToken: string; user: AdminUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  }),
};
