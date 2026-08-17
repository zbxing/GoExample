import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseApiInventoryDocument } from '@/lib/server/api-inventory-parser';

describe('OpenAPI inventory parser', () => {
  it('reads the workspace OpenAPI document as the management inventory', async () => {
    const content = await readFile(
      path.resolve(process.cwd(), '..', 'docs', 'openapi', 'openapi.json'),
      'utf8',
    );
    const inventory = parseApiInventoryDocument(JSON.parse(content));

    expect(inventory?.specVersion).toBe('3.1.0');
    expect(inventory?.operations).toHaveLength(17);
    expect(inventory?.operations).toContainEqual(
      expect.objectContaining({ method: 'GET', path: '/api/v1/project' }),
    );
    expect(inventory?.securedOperationCount).toBe(3);
    expect(inventory?.securitySchemes.map((scheme) => scheme.name)).toEqual([
      'bearerAuth',
      'internalBearer',
    ]);
  });

  it('honors document and operation security requirements', () => {
    const inventory = parseApiInventoryDocument({
      openapi: '3.1.0',
      info: { title: 'Test', version: '1' },
      security: [{ bearerAuth: [] }],
      paths: {
        '/secured': { get: { operationId: 'secured' } },
        '/public': { get: { operationId: 'public', security: [] } },
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    });

    expect(inventory?.operations.find((operation) => operation.path === '/secured')?.secured).toBe(true);
    expect(inventory?.operations.find((operation) => operation.path === '/public')?.secured).toBe(false);
  });

  it('rejects documents without required OpenAPI structures', () => {
    expect(parseApiInventoryDocument({ openapi: '3.1.0' })).toBeNull();
  });
});
