import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const defaultOperations = Object.freeze({
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
});

function temporaryOutputPath(outputPath) {
  const suffix = `${process.pid}-${randomBytes(16).toString('hex')}`;
  return path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${suffix}.tmp`);
}

export function writeFileAtomicallySync(outputPath, data, {
  encoding = 'utf8',
  mode = 0o666,
  operations = defaultOperations,
} = {}) {
  const temporaryPath = temporaryOutputPath(outputPath);
  let descriptor = null;
  let committed = false;
  let primaryError = null;

  try {
    descriptor = operations.openSync(temporaryPath, 'wx', mode);
    operations.writeFileSync(descriptor, data, { encoding });
    operations.fsyncSync(descriptor);
    operations.closeSync(descriptor);
    descriptor = null;
    operations.renameSync(temporaryPath, outputPath);
    committed = true;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (descriptor !== null) {
      try {
        operations.closeSync(descriptor);
      } catch (error) {
        if (primaryError === null) {
          throw error;
        }
      }
    }
    if (!committed) {
      try {
        operations.rmSync(temporaryPath, { force: true });
      } catch (error) {
        if (primaryError === null) {
          throw error;
        }
      }
    }
  }
}

function normalizedOutputKey(outputPath) {
  const resolved = path.resolve(outputPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function writeFilesWithRollbackSync(outputs, {
  writeOutput = writeFileAtomicallySync,
  removeOutput = (outputPath) => rmSync(outputPath, { force: true }),
} = {}) {
  if (!Array.isArray(outputs) || outputs.length < 2) {
    throw new TypeError('outputs must contain at least two files');
  }
  const normalized = outputs.map((output, index) => {
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      throw new TypeError(`outputs[${index}] must be an object`);
    }
    if (typeof output.outputPath !== 'string' || output.outputPath.length === 0) {
      throw new TypeError(`outputs[${index}].outputPath must be a non-empty string`);
    }
    return {
      outputPath: output.outputPath,
      data: output.data,
      encoding: output.encoding ?? 'utf8',
      mode: output.mode ?? 0o666,
    };
  });
  const keys = normalized.map(({ outputPath }) => normalizedOutputKey(outputPath));
  if (new Set(keys).size !== keys.length) {
    throw new TypeError('outputs must use distinct paths');
  }

  const snapshots = normalized.map(({ outputPath }, index) => {
    if (!existsSync(outputPath)) {
      return { exists: false };
    }
    const stat = lstatSync(outputPath);
    if (!stat.isFile()) {
      throw new TypeError(`outputs[${index}].outputPath must be a regular file`);
    }
    return {
      exists: true,
      data: readFileSync(outputPath),
      mode: stat.mode & 0o7777,
    };
  });

  let committed = 0;
  try {
    for (const output of normalized) {
      writeOutput(output.outputPath, output.data, {
        encoding: output.encoding,
        mode: output.mode,
      });
      committed += 1;
    }
  } catch (primaryError) {
    const rollbackErrors = [];
    for (let index = committed - 1; index >= 0; index -= 1) {
      const output = normalized[index];
      const snapshot = snapshots[index];
      try {
        if (snapshot.exists) {
          writeOutput(output.outputPath, snapshot.data, { mode: snapshot.mode });
        } else {
          removeOutput(output.outputPath);
        }
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [primaryError, ...rollbackErrors],
        'output publication failed and rollback was incomplete',
        { cause: primaryError },
      );
    }
    throw primaryError;
  }
}
