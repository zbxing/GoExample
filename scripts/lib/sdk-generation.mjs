import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { writeFileAtomicallySync } from './atomic-output.mjs';
import {
  maximumCommandDurationMs,
  maximumCommandOutputBytes,
} from './bounded-command.mjs';

export const maximumFormatterDiagnosticCharacters = 4_096;

const retryableFormatterLaunchErrorCodes = new Set(['ENOENT', 'EINVAL']);

const defaultOperations = Object.freeze({
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
});

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function boundedFormatterDiagnostic(value) {
  const diagnostic = `${value ?? ''}`.trim();
  if (diagnostic.length <= maximumFormatterDiagnosticCharacters) {
    return diagnostic;
  }
  return `${diagnostic.slice(0, maximumFormatterDiagnosticCharacters - 3)}...`;
}

function formatterFailureDetail(result) {
  if (result?.error?.code === 'ETIMEDOUT') {
    return `timed out after ${maximumCommandDurationMs} ms`;
  }
  if (result?.error?.code === 'ENOBUFS') {
    return `output exceeded ${maximumCommandOutputBytes} bytes`;
  }
  if (result?.signal) {
    return `terminated by signal ${result.signal}`;
  }
  const stderr = boundedFormatterDiagnostic(result?.stderr);
  if (stderr) {
    return stderr;
  }
  if (Number.isInteger(result?.status)) {
    return `exit code ${result.status}`;
  }
  return result?.error?.message || result?.error?.code || 'unknown process failure';
}

function formatterFailureError(result, cause = result?.error) {
  const detail = boundedFormatterDiagnostic(formatterFailureDetail(result));
  return cause === undefined
    ? new Error(`gofmt failed: ${detail}`)
    : new Error(`gofmt failed: ${detail}`, { cause });
}

export function formatGoFileWithCandidatesSync(filePath, {
  candidates,
  cwd,
  spawn = spawnSync,
  fileExists = existsSync,
} = {}) {
  requireNonEmptyString(filePath, 'Go formatter file path');
  requireNonEmptyString(cwd, 'Go formatter working directory');
  if (
    !Array.isArray(candidates) ||
    candidates.length === 0 ||
    candidates.some((candidate) => typeof candidate !== 'string' || candidate.length === 0)
  ) {
    throw new Error('Go formatter candidates must be a non-empty string array');
  }
  if (typeof spawn !== 'function') {
    throw new Error('Go formatter spawn must be a function');
  }
  if (typeof fileExists !== 'function') {
    throw new Error('Go formatter existence check must be a function');
  }

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && !fileExists(candidate)) {
      continue;
    }

    let result;
    try {
      result = spawn(candidate, ['-w', filePath], {
        cwd,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        maxBuffer: maximumCommandOutputBytes,
        timeout: maximumCommandDurationMs,
        killSignal: 'SIGTERM',
      });
    } catch (error) {
      if (retryableFormatterLaunchErrorCodes.has(error?.code)) {
        continue;
      }
      throw formatterFailureError({ error }, error);
    }

    if (result?.status === 0) {
      return;
    }
    if (
      result?.status === null &&
      retryableFormatterLaunchErrorCodes.has(result.error?.code)
    ) {
      continue;
    }
    throw formatterFailureError(result);
  }

  throw new Error('gofmt was not found; run yarn env or set GOFMT_BINARY');
}

export function formatGeneratedGoSDKSourceSync(source, {
  stagingRoot,
  formatFile,
  operations = defaultOperations,
} = {}) {
  requireNonEmptyString(source, 'generated SDK source');
  requireNonEmptyString(stagingRoot, 'SDK generation staging root');
  if (typeof formatFile !== 'function') {
    throw new Error('SDK formatter must be a function');
  }

  operations.mkdirSync(stagingRoot, { recursive: true });
  const stagingDirectory = operations.mkdtempSync(path.join(stagingRoot, 'go-sdk-'));
  const stagedClientPath = path.join(stagingDirectory, 'client.gen.go');
  let formattedSource;
  let primaryError = null;

  try {
    operations.writeFileSync(stagedClientPath, source, 'utf8');
    formatFile(stagedClientPath);
    formattedSource = operations.readFileSync(stagedClientPath, 'utf8');
  } catch (error) {
    primaryError = error;
  }

  try {
    operations.rmSync(stagingDirectory, { recursive: true, force: true });
  } catch (cleanupError) {
    if (primaryError !== null) {
      throw new AggregateError(
        [primaryError, cleanupError],
        'SDK generation and staging cleanup both failed',
        { cause: primaryError },
      );
    }
    throw cleanupError;
  }

  if (primaryError !== null) {
    throw primaryError;
  }
  return formattedSource;
}

function snapshotFile(filePath, operations) {
  if (!operations.existsSync(filePath)) {
    return { exists: false, data: null };
  }
  return { exists: true, data: operations.readFileSync(filePath) };
}

function restoreFile(filePath, snapshot, writeOutput, operations) {
  if (snapshot.exists) {
    writeOutput(filePath, snapshot.data, { encoding: 'utf8' });
    return;
  }
  operations.rmSync(filePath, { force: true });
}

export function publishGeneratedGoSDKSync({
  clientPath,
  versionPath,
  formattedSource,
  version,
  writeOutput = writeFileAtomicallySync,
  operations = defaultOperations,
}) {
  requireNonEmptyString(clientPath, 'generated SDK client path');
  requireNonEmptyString(versionPath, 'generated SDK version path');
  requireNonEmptyString(formattedSource, 'formatted SDK source');
  requireNonEmptyString(version, 'generated SDK version');
  if (path.resolve(clientPath) === path.resolve(versionPath)) {
    throw new Error('generated SDK client and version paths must be distinct');
  }
  if (typeof writeOutput !== 'function') {
    throw new Error('SDK output publisher must be a function');
  }

  const outputs = [
    {
      path: clientPath,
      data: formattedSource,
      snapshot: snapshotFile(clientPath, operations),
    },
    {
      path: versionPath,
      data: `${version}\n`,
      snapshot: snapshotFile(versionPath, operations),
    },
  ];
  const published = [];

  try {
    for (const output of outputs) {
      writeOutput(output.path, output.data, { encoding: 'utf8' });
      published.push(output);
    }
  } catch (publicationError) {
    const rollbackErrors = [];
    for (const output of published.reverse()) {
      try {
        restoreFile(output.path, output.snapshot, writeOutput, operations);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [publicationError, ...rollbackErrors],
        'SDK publication failed and rollback was incomplete',
        { cause: publicationError },
      );
    }
    throw publicationError;
  }
}
