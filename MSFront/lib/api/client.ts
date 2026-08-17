import { siteConfig } from '@/lib/config/site';

export function createApiClient(baseUrl?: string) {
  const resolvedBaseUrl = (baseUrl ?? siteConfig.apiBaseUrl).replace(/\/+$/, '');

  return {
    async request<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
      const headers = new Headers({ 'x-management-console': 'GoExample' });
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
      if (init.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      const response = await fetch(`${resolvedBaseUrl}/${path.replace(/^\/+/, '')}`, {
        ...init,
        method: init.method?.toUpperCase(),
        headers,
      });
      const payload = (await response.json()) as ApiEnvelope<T>;

      if (!response.ok || payload.code !== 0) {
        throw new Error(payload.msg || `Request failed: ${response.status}`);
      }
      return payload;
    },
  };
}

export interface ApiEnvelope<T> {
  code: number;
  data: T;
  msg: string;
}

export async function apiFetch<T>(
  input: string,
  init?: RequestInit,
): Promise<ApiEnvelope<T>> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'same-origin',
  });

  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.msg || `Request failed: ${response.status}`);
  }

  return payload;
}
