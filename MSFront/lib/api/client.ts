import { siteConfig } from '@/lib/config/site';
import { beginGvaContentLoading, endGvaContentLoading } from '@/lib/utils/gva-page-loading';

export function createApiClient(baseUrl?: string) {
  const resolvedBaseUrl = (baseUrl ?? siteConfig.apiBaseUrl).replace(/\/+$/, '');

  return {
    async request<T>(
      path: string,
      init: RequestInit & { donNotShowLoading?: boolean } = {},
    ): Promise<ApiEnvelope<T>> {
      const { donNotShowLoading, ...requestInit } = init;
      const headers = new Headers({ 'x-management-console': 'GoExample' });
      new Headers(requestInit.headers).forEach((value, key) => headers.set(key, value));
      if (requestInit.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      if (!donNotShowLoading && typeof window !== 'undefined') {
        beginGvaContentLoading();
      }
      try {
        const response = await fetch(`${resolvedBaseUrl}/${path.replace(/^\/+/, '')}`, {
          ...requestInit,
          method: requestInit.method?.toUpperCase(),
          headers,
        });
        const payload = (await response.json()) as ApiEnvelope<T>;

        if (!response.ok || payload.code !== 0) {
          throw new Error(payload.msg || `Request failed: ${response.status}`);
        }
        return payload;
      } finally {
        if (!donNotShowLoading && typeof window !== 'undefined') {
          endGvaContentLoading();
        }
      }
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
  init?: RequestInit & { donNotShowLoading?: boolean },
): Promise<ApiEnvelope<T>> {
  const { donNotShowLoading, ...requestInit } = init ?? {};
  if (!donNotShowLoading && typeof window !== 'undefined') {
    beginGvaContentLoading();
  }
  try {
    const response = await fetch(input, {
      ...requestInit,
      headers: {
        'Content-Type': 'application/json',
        ...(requestInit.headers ?? {}),
      },
      credentials: 'same-origin',
    });

    const payload = (await response.json()) as ApiEnvelope<T>;
    if (!response.ok || payload.code !== 0) {
      throw new Error(payload.msg || `Request failed: ${response.status}`);
    }

    return payload;
  } finally {
    if (!donNotShowLoading && typeof window !== 'undefined') {
      endGvaContentLoading();
    }
  }
}
