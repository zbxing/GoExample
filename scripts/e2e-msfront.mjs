import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, '..');
const sourceDataDirectory = path.join(repositoryRoot, 'MSFront', 'data');
const playwrightCli = path.join(
  repositoryRoot,
  'node_modules',
  '@playwright',
  'test',
  'cli.js',
);

async function firstAccessiblePath(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue through the supported local browser locations.
    }
  }
  return '';
}

async function resolveLocalBrowser() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.platform !== 'win32') {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '';
  }

  return firstAccessiblePath([
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ]);
}

async function run() {
  await access(playwrightCli, fsConstants.R_OK).catch(() => {
    throw new Error('Playwright is not installed. Run `yarn env` or `yarn install` first.');
  });

  const temporaryDataDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'goexample-msfront-e2e-'),
  );
  await cp(sourceDataDirectory, temporaryDataDirectory, { recursive: true });

  const browserExecutable = await resolveLocalBrowser();
  const environment = {
    ...process.env,
    MSFRONT_DATA_DIR: temporaryDataDirectory,
    MSFRONT_JWT_SECRET: 'msfront-e2e-only-jwt-secret-32-characters',
    ...(browserExecutable
      ? { PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: browserExecutable }
      : {}),
  };

  const child = spawn(process.execPath, [playwrightCli, 'test', ...process.argv.slice(2)], {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });

  const forwardSignal = (signal) => child.kill(signal);
  process.once('SIGINT', forwardSignal);
  process.once('SIGTERM', forwardSignal);

  try {
    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)));
    });
    process.exitCode = exitCode;
  } finally {
    process.removeListener('SIGINT', forwardSignal);
    process.removeListener('SIGTERM', forwardSignal);
    await rm(temporaryDataDirectory, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
