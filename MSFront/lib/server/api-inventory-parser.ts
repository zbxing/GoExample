import type {
  ApiInventoryArea,
  ApiInventoryOperationEntry,
  ApiInventorySecurityScheme,
  ApiInventorySummary,
} from '@/lib/types/management';

const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);

export function parseApiInventoryDocument(value: unknown): ApiInventorySummary | null {
  if (!isRecord(value) || !isRecord(value.info) || !isRecord(value.paths)) {
    return null;
  }

  const operations: ApiInventoryOperationEntry[] = [];
  const inheritedSecurity = normalizeSecurityRequirements(value.security);

  for (const [routePath, rawPathItem] of Object.entries(value.paths)) {
    if (!isRecord(rawPathItem)) {
      continue;
    }

    for (const [rawMethod, rawOperation] of Object.entries(rawPathItem)) {
      const method = rawMethod.toLowerCase();

      if (!httpMethods.has(method) || !isRecord(rawOperation)) {
        continue;
      }

      const securitySchemes = Object.hasOwn(rawOperation, 'security')
        ? normalizeSecurityRequirements(rawOperation.security)
        : inheritedSecurity;
      operations.push({
        id: `${method.toUpperCase()}:${routePath}`,
        method: method.toUpperCase(),
        path: routePath,
        area: classifyArea(routePath),
        secured: securitySchemes.length > 0,
        securitySchemes,
        deprecated: rawOperation.deprecated === true,
      });
    }
  }

  operations.sort(
    (left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method),
  );
  const securitySchemes = normalizeSecuritySchemes(value.components);

  return {
    specVersion: `${value.openapi ?? 'unknown'}`,
    title: `${value.info.title ?? 'API Inventory'}`,
    version: `${value.info.version ?? 'unknown'}`,
    operations,
    authPaths: uniquePaths(operations.filter((operation) => operation.area === 'auth')),
    examplePaths: uniquePaths(operations.filter((operation) => operation.area === 'example')),
    securitySchemes,
    securedOperationCount: operations.filter((operation) => operation.secured).length,
    deprecatedOperationCount: operations.filter((operation) => operation.deprecated).length,
  };
}

function normalizeSecuritySchemes(components: unknown): ApiInventorySecurityScheme[] {
  if (!isRecord(components) || !isRecord(components.securitySchemes)) {
    return [];
  }

  return Object.entries(components.securitySchemes)
    .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
    .map(([name, scheme]) => ({
      name,
      type: `${scheme.type ?? 'unknown'}`,
      scheme: optionalString(scheme.scheme),
      bearerFormat: optionalString(scheme.bearerFormat),
      location: optionalString(scheme.in),
      parameterName: optionalString(scheme.name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeSecurityRequirements(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.flatMap((requirement) => (isRecord(requirement) ? Object.keys(requirement) : [])))];
}

function classifyArea(routePath: string): ApiInventoryArea {
  if (routePath.startsWith('/api/v1/auth')) {
    return 'auth';
  }

  if (routePath.startsWith('/api/v1/example')) {
    return 'example';
  }

  if (
    routePath === '/' ||
    routePath === '/metrics' ||
    routePath.endsWith('z') ||
    routePath.startsWith('/api/health') ||
    routePath.startsWith('/api/system')
  ) {
    return 'platform';
  }

  return 'other';
}

function uniquePaths(operations: ApiInventoryOperationEntry[]) {
  return [...new Set(operations.map((operation) => operation.path))].sort();
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
