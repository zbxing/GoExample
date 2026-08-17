import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptRoot, '..', '..');
const frontRoot = path.join(repositoryRoot, 'MSFront');
const apiRoot = path.join(frontRoot, 'app', 'api');
const typescriptEntry = path.join(frontRoot, 'node_modules', 'typescript', 'lib', 'typescript.js');
const protectedRoots = ['management', 'system'];
const httpMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

if (!existsSync(typescriptEntry)) {
  throw new Error('MSFront TypeScript is not installed. Run yarn env first.');
}

const typescriptModule = await import(pathToFileURL(typescriptEntry).href);
const ts = typescriptModule.default ?? typescriptModule;

function routeFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return routeFiles(target);
    }
    return entry.name === 'route.ts' ? [target] : [];
  });
}

function isExported(node) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function callsAccessGuard(body, requestName) {
  let guarded = false;
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'requireApiAccess' &&
      node.arguments.length > 0 &&
      ts.isIdentifier(node.arguments[0]) &&
      node.arguments[0].text === requestName
    ) {
      guarded = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(body);
  return guarded;
}

function callsRawRequestJson(body, requestName) {
  let found = false;
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'json' &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === requestName
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(body);
  return found;
}

const failures = [];
let handlerCount = 0;

for (const protectedRoot of protectedRoots) {
  const root = path.join(apiRoot, protectedRoot);
  for (const file of routeFiles(root)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    for (const statement of source.statements) {
      if (
        !ts.isFunctionDeclaration(statement) ||
        !statement.name ||
        !httpMethods.has(statement.name.text) ||
        !isExported(statement)
      ) {
        continue;
      }

      handlerCount += 1;
      const requestParameter = statement.parameters[0];
      const requestName = requestParameter && ts.isIdentifier(requestParameter.name)
        ? requestParameter.name.text
        : null;
      if (!requestName || !statement.body || !callsAccessGuard(statement.body, requestName)) {
        const relativeFile = path.relative(repositoryRoot, file);
        failures.push(`${relativeFile}: ${statement.name.text} must call requireApiAccess(request)`);
      }
    }
  }
}

for (const file of routeFiles(apiRoot)) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  for (const statement of source.statements) {
    if (
      !ts.isFunctionDeclaration(statement) ||
      !statement.name ||
      !httpMethods.has(statement.name.text) ||
      !isExported(statement) ||
      !statement.body
    ) {
      continue;
    }

    const requestParameter = statement.parameters[0];
    const requestName = requestParameter && ts.isIdentifier(requestParameter.name)
      ? requestParameter.name.text
      : null;
    if (requestName && callsRawRequestJson(statement.body, requestName)) {
      const relativeFile = path.relative(repositoryRoot, file);
      failures.push(
        `${relativeFile}: ${statement.name.text} must use readJsonBody(request, schema)`,
      );
    }
  }
}

if (handlerCount === 0) {
  failures.push('No protected MSFront Route Handlers were found.');
}

if (failures.length > 0) {
  console.error('[routes] Authorization contract failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `[routes] Verified authorization for ${handlerCount} protected Route Handlers and schema-based JSON parsing`,
  );
}
