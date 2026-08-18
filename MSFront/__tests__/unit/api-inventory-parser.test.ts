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

  it('keeps every OpenAPI reference and security scheme resolvable', async () => {
    const content = await readFile(
      path.resolve(process.cwd(), '..', 'docs', 'openapi', 'openapi.json'),
      'utf8',
    );
    const document = JSON.parse(content) as Record<string, unknown>;
    const references = collectReferences(document);
    const securitySchemeNames = new Set(
      Object.keys(
        (document.components as { securitySchemes?: Record<string, unknown> }).securitySchemes ?? {},
      ),
    );

    for (const reference of references) {
      expect(resolveReference(document, reference), reference).toBeDefined();
    }

    for (const operation of collectOperations(document)) {
      for (const requirement of operation.security ?? []) {
        for (const schemeName of Object.keys(requirement)) {
          expect(securitySchemeNames.has(schemeName), schemeName).toBe(true);
        }
      }
    }
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

function collectReferences(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectReferences);
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value).flatMap(([key, entry]) => [
    ...(key === '$ref' && typeof entry === 'string' ? [entry] : []),
    ...collectReferences(entry),
  ]);
}

function resolveReference(document: Record<string, unknown>, reference: string) {
  if (!reference.startsWith('#/')) {
    return undefined;
  }

  return reference
    .slice(2)
    .split('/')
    .reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object') {
        return undefined;
      }
      return (current as Record<string, unknown>)[segment.replaceAll('~1', '/').replaceAll('~0', '~')];
    }, document);
}

function collectOperations(document: Record<string, unknown>) {
  const paths = document.paths;
  if (!paths || typeof paths !== 'object') {
    return [];
  }

  return Object.values(paths).flatMap((pathItem) => {
    if (!pathItem || typeof pathItem !== 'object') {
      return [];
    }
    return Object.values(pathItem).filter(
      (operation): operation is { security?: Array<Record<string, unknown>> } =>
        Boolean(operation && typeof operation === 'object' && 'responses' in operation),
    );
  });
}
