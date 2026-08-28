import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSDKReleaseManifest,
  verifySDKReleaseManifest,
  writeSDKReleaseManifest,
} from './lib/sdk-release.mjs';
import { readProjectManifest, selectProject } from './lib/project-contracts.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, '..');
const args = process.argv.slice(2);
const task = args.shift() ?? 'verify';
let projectSelector = null;

function fail(message) {
  throw new Error(`SDK release readiness: ${message}`);
}

function parseArguments() {
  if (!['prepare', 'verify'].includes(task)) {
    fail('usage: node scripts/sdk-release.mjs <prepare|verify> [--project <name>]');
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const [name, inlineValue] = argument.split('=', 2);
    if (name !== '--project') {
      fail(`unknown argument ${argument}`);
    }
    const value = inlineValue ?? args[++index];
    if (!value || value.startsWith('--')) {
      fail('--project requires a value');
    }
    if (projectSelector) {
      fail('--project may only be specified once');
    }
    projectSelector = value;
  }
}

function sourceCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  const commit = result.stdout.trim();
  if (result.status !== 0 || !/^[a-f0-9]{40}$/.test(commit)) {
    fail(`cannot resolve repository source commit: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return commit;
}

function recordedSourceCommit(project) {
  const manifestPath = path.join(repositoryRoot, project.sdk.path, 'release-manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`cannot read ${project.sdk.path}/release-manifest.json: ${error.message}`);
  }
  if (!/^[a-f0-9]{40}$/.test(manifest?.sourceCommit ?? '')) {
    fail(`${project.sdk.path}/release-manifest.json has an invalid sourceCommit`);
  }
  return manifest.sourceCommit;
}

function verifyGeneratedSDK(project) {
  const result = spawnSync(
    process.execPath,
    [path.join(currentDirectory, 'go-sdk.mjs'), 'check', '--project', project.name],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    fail(`generated SDK check failed for ${project.name}: ${(result.stderr || result.stdout || '').trim()}`);
  }
}

function run() {
  parseArguments();
  const manifest = readProjectManifest(repositoryRoot);
  const projects = projectSelector ? [selectProject(manifest, projectSelector)] : manifest.projects;
  const commit = task === 'prepare' ? sourceCommit() : null;

  for (const project of projects) {
    verifyGeneratedSDK(project);
    const releaseManifest = buildSDKReleaseManifest(repositoryRoot, project, {
      sourceCommit: commit ?? recordedSourceCommit(project),
    });
    if (task === 'prepare') {
      writeSDKReleaseManifest(repositoryRoot, project, releaseManifest);
      console.log(
        `Prepared ${project.sdk.path}/release-manifest.json for expected tag ${releaseManifest.expectedTag} (not published or verified).`,
      );
    } else {
      verifySDKReleaseManifest(repositoryRoot, project, releaseManifest);
      console.log(
        `Verified ${project.sdk.path}/release-manifest.json for expected tag ${releaseManifest.expectedTag} (publication not checked).`,
      );
    }
  }
}

try {
  run();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
