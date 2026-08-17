import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('server-only', () => ({}));

import {
  RequestBodyError,
  apiErrorResponse,
  readJsonBody,
} from '@/lib/server/request-body';

const schema = z.object({ name: z.string().min(1), count: z.number().int() }).strict();

describe('request body parsing', () => {
  it('accepts JSON media types and returns validated data', async () => {
    const request = new Request('http://localhost/api', {
      method: 'POST',
      headers: { 'content-type': 'application/problem+json; charset=utf-8' },
      body: JSON.stringify({ name: 'demo', count: 2 }),
    });

    await expect(readJsonBody(request, schema)).resolves.toEqual({ name: 'demo', count: 2 });
  });

  it.each([
    ['text/plain', 'UNSUPPORTED_MEDIA_TYPE', 415, 'plain text'],
    ['application/json', 'INVALID_JSON', 400, '{broken'],
  ])('rejects invalid media or JSON', async (contentType, code, status, body) => {
    const request = new Request('http://localhost/api', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });

    await expect(readJsonBody(request, schema)).rejects.toMatchObject({ code, status });
  });

  it('rejects oversized and schema-invalid bodies with stable error codes', async () => {
    const oversized = new Request('http://localhost/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'long-name', count: 1 }),
    });
    await expect(readJsonBody(oversized, schema, 8)).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      status: 413,
    });

    const invalid = new Request('http://localhost/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', count: 1, extra: true }),
    });
    await expect(readJsonBody(invalid, schema)).rejects.toMatchObject({
      code: 'INVALID_REQUEST_BODY',
      status: 422,
      issues: expect.any(Array),
    });
  });

  it('exposes validation failures but hides unexpected error messages', async () => {
    const validation = apiErrorResponse(
      new RequestBodyError('INVALID_JSON', 400, 'Request body must contain valid JSON.'),
      'Fallback message',
    );
    expect(validation.status).toBe(400);
    await expect(validation.json()).resolves.toMatchObject({
      error: { code: 'INVALID_JSON' },
    });

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unexpected = apiErrorResponse(new Error('database secret'), 'Request failed.');
    expect(unexpected.status).toBe(500);
    await expect(unexpected.json()).resolves.toEqual({ message: 'Request failed.' });
    expect(consoleError).toHaveBeenCalledOnce();
  });
});
