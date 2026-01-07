export type ApiError = {
  status: number;
  message: string;
};

const DEFAULT_BASE_URL = 'http://localhost:8000';

export function getApiBaseUrl(): string {
  // Expo: 通过 EXPO_PUBLIC_API_BASE_URL 注入
  const v = process.env.EXPO_PUBLIC_API_BASE_URL;
  return (v && v.trim()) || DEFAULT_BASE_URL;
}

async function parseError(res: Response): Promise<ApiError> {
  let message = res.statusText || 'Request failed';
  try {
    const data = await res.json();
    if (data?.detail) message = String(data.detail);
  } catch {
    // ignore
  }
  return { status: res.status, message };
}

export async function apiGet<T>(path: string): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body?: any): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

