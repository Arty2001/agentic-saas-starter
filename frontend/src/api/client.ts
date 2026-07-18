const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
  });
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent("auth-expired"));
  }
  return response;
}

function httpError(response: Response): Error {
  return new Error(`HTTP ${response.status}: ${response.statusText}`);
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await request(path);
  if (!response.ok) throw httpError(response);
  return response.json() as Promise<T>;
}

export async function apiDelete(path: string): Promise<void> {
  const response = await request(path, { method: "DELETE" });
  if (!response.ok) throw httpError(response);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw httpError(response);
  return response.json() as Promise<T>;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const response = await request(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw httpError(response);
  return response.json() as Promise<T>;
}

export async function apiDownload(path: string, filename: string): Promise<void> {
  const response = await request(path);
  if (!response.ok) throw httpError(response);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function getApiBase(): string {
  return API_BASE;
}
