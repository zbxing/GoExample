import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertOpenAPIDocument,
  readProjectManifest,
  resolveProjectDocument,
} from './project-contracts.mjs';

export const SDK_CONSUMER_MATRIX_PATH = 'contracts/sdk-consumer-matrix.json';
export const sdkConsumerMatrixSchemaVersion = 1;

const SEMVER = /^\d+\.\d+\.\d+$/;
const RELATIVE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const API_PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const REPOSITORY_LOCAL = 'repository_local';
const NOT_RECORDED = 'not_recorded';
const NOT_CHECKED = 'not_checked';

function fail(message) {
  throw new Error(`SDK consumer matrix: ${message}`);
}

function object(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${name} must be an object`);
  }
  return value;
}

function exactKeys(value, keys, name) {
  const actual = Object.keys(object(value, name)).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${name} keys must be exactly ${expected.join(', ')}`);
  }
  return value;
}

function string(value, name, pattern = null) {
  if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value))) {
    fail(`${name} is invalid`);
  }
  return value;
}

function pathValue(value, name) {
  string(value, name, RELATIVE_PATH);
  if (value.includes('..') || value.includes('//') || value.includes('\\')) {
    fail(`${name} contains an unsafe path`);
  }
  return value;
}

function apiPath(value, name) {
  return string(value, name, API_PATH);
}

function readJSON(repositoryRoot) {
  const filePath = path.join(repositoryRoot, ...SDK_CONSUMER_MATRIX_PATH.split('/'));
  if (!existsSync(filePath) || !lstatSync(filePath).isFile()) {
    fail(`${SDK_CONSUMER_MATRIX_PATH} is missing`);
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    fail(`${SDK_CONSUMER_MATRIX_PATH} must contain valid JSON`);
  }
}

function list(value, name, mapper) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${name} must be a non-empty array`);
  }
  return value.map((entry, index) => mapper(entry, `${name}[${index}]`));
}

function validateMatrix(document) {
  exactKeys(document, ['schemaVersion', 'sunset', 'consumers', 'release', 'limitations'], 'matrix');
  if (document.schemaVersion !== sdkConsumerMatrixSchemaVersion) {
    fail('schemaVersion is unsupported');
  }

  const sunset = exactKeys(document.sunset, ['deprecatedAt', 'sunsetAt', 'minimumWindowDays'], 'sunset');
  string(sunset.deprecatedAt, 'sunset.deprecatedAt', TIMESTAMP);
  string(sunset.sunsetAt, 'sunset.sunsetAt', TIMESTAMP);
  const deprecatedAt = Date.parse(sunset.deprecatedAt);
  const sunsetAt = Date.parse(sunset.sunsetAt);
  if (!Number.isSafeInteger(sunset.minimumWindowDays) || sunset.minimumWindowDays < 1) {
    fail('sunset.minimumWindowDays is invalid');
  }
  const windowDays = (sunsetAt - deprecatedAt) / 86_400_000;
  if (deprecatedAt >= sunsetAt || windowDays < sunset.minimumWindowDays) {
    fail('sunset window is shorter than the declared minimum');
  }

  const consumers = list(document.consumers, 'consumers', (entry, name) => {
    exactKeys(
      entry,
      [
        'name',
        'projectPath',
        'modulePath',
        'sdkPath',
        'sdkVersion',
        'contractVersion',
        'canonicalPaths',
        'deprecatedPaths',
        'migrationStatus',
        'deploymentStatus',
      ],
      name,
    );
    string(entry.name, `${name}.name`, /^[A-Za-z][A-Za-z0-9_-]*$/);
    pathValue(entry.projectPath, `${name}.projectPath`);
    pathValue(entry.modulePath, `${name}.modulePath`);
    pathValue(entry.sdkPath, `${name}.sdkPath`);
    string(entry.sdkVersion, `${name}.sdkVersion`, SEMVER);
    string(entry.contractVersion, `${name}.contractVersion`, SEMVER);
    list(entry.canonicalPaths, `${name}.canonicalPaths`, apiPath);
    if (!Array.isArray(entry.deprecatedPaths)) {
      fail(`${name}.deprecatedPaths must be an array`);
    }
    entry.deprecatedPaths.forEach((value, index) => apiPath(value, `${name}.deprecatedPaths[${index}]`));
    if (entry.migrationStatus !== REPOSITORY_LOCAL || entry.deploymentStatus !== NOT_RECORDED) {
      fail(`${name} must remain repository_local with deploymentStatus not_recorded`);
    }
    return entry;
  });
  if (new Set(consumers.map((entry) => entry.name)).size !== consumers.length) {
    fail('consumers must have unique names');
  }

  const release = exactKeys(
    document.release,
    ['formalTag', 'packagePublication', 'externalConsumerMatrix', 'deprecationWindowExecution', 'targetDeployment'],
    'release',
  );
  if (
    release.formalTag !== NOT_CHECKED ||
    release.packagePublication !== NOT_CHECKED ||
    release.externalConsumerMatrix !== NOT_RECORDED ||
    release.deprecationWindowExecution !== NOT_RECORDED ||
    release.targetDeployment !== NOT_RECORDED
  ) {
    fail('release status must keep unchecked or not_recorded boundaries');
  }
  const limitations = list(document.limitations, 'limitations', (value, name) => string(value, name));
  const expectedLimitations = [
    'the matrix binds repository-local consumers, generated SDK versions, and the documented deprecation window',
    'it does not prove a formal tag, package publication, external consumer execution, or target deployment migration',
  ];
  if (limitations.length !== expectedLimitations.length || limitations.some((value, index) => value !== expectedLimitations[index])) {
    fail('limitations must retain the fixed repository-only boundaries');
  }
  return { ...document, consumers };
}

export function readSDKConsumerMatrix(repositoryRoot) {
  return validateMatrix(readJSON(repositoryRoot));
}

function readReleaseManifest(repositoryRoot, sdkPath, name) {
  const filePath = path.join(repositoryRoot, ...sdkPath.split('/'), 'release-manifest.json');
  if (!existsSync(filePath) || !lstatSync(filePath).isFile()) {
    fail(`${name} release manifest is missing`);
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    fail(`${name} release manifest must contain valid JSON`);
  }
}

export function verifySDKConsumerMatrix(repositoryRoot) {
  const matrix = readSDKConsumerMatrix(repositoryRoot);
  const projects = readProjectManifest(repositoryRoot).projects;
  const matrixProjects = new Set();
  for (const consumer of matrix.consumers) {
    if (matrixProjects.has(consumer.projectPath)) {
      fail(`duplicate projectPath ${consumer.projectPath}`);
    }
    matrixProjects.add(consumer.projectPath);
    const project = projects.find((entry) => entry.projectPath === consumer.projectPath);
    if (!project) {
      fail(`${consumer.name} projectPath is not registered`);
    }
    if (project.sdk.path !== consumer.sdkPath) {
      fail(`${consumer.name} sdkPath does not match contracts/projects.json`);
    }
    const documentSource = resolveProjectDocument(repositoryRoot, project);
    const document = assertOpenAPIDocument(documentSource.content, documentSource.source);
    if (document.info.version !== consumer.contractVersion) {
      fail(`${consumer.name} contractVersion does not match OpenAPI`);
    }
    const release = readReleaseManifest(repositoryRoot, consumer.sdkPath, consumer.name);
    if (release.sdkVersion !== consumer.sdkVersion || release.openapi?.version !== consumer.contractVersion) {
      fail(`${consumer.name} versions do not match its release manifest`);
    }
    if (release.publication !== NOT_CHECKED || release.expectedTag !== `${consumer.sdkPath}/v${consumer.sdkVersion}`) {
      fail(`${consumer.name} release publication/tag boundary is invalid`);
    }
  }
  const matrixDocPath = path.join(repositoryRoot, 'docs', 'openapi', 'consumer-matrix.md');
  const matrixDoc = readFileSync(matrixDocPath, 'utf8');
  if (!matrixDoc.includes('repository-local consumer only') || !matrixDoc.includes('2027-02-20')) {
    fail('docs/openapi/consumer-matrix.md must retain repository-local and sunset boundaries');
  }
  return { schemaVersion: matrix.schemaVersion, consumerCount: matrix.consumers.length };
}
