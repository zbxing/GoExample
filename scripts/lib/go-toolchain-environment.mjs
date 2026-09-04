import { existsSync } from 'node:fs';

export function isolatedGoToolchainEnvironment(environment = process.env, overrides = {}) {
  const isolated = { ...environment, ...overrides };
  for (const name of Object.keys(isolated)) {
    if (name.toLowerCase() === 'goroot') {
      delete isolated[name];
    }
  }
  return isolated;
}

export function selectRepositoryToolCommand({
  configuredCommand,
  repositoryCandidates,
  fallbackCommand,
}) {
  const explicitCommand = typeof configuredCommand === 'string' ? configuredCommand.trim() : '';
  if (explicitCommand) {
    return { command: explicitCommand, repositoryManaged: false };
  }

  const repositoryCommand = repositoryCandidates.find(
    (candidate) => typeof candidate === 'string' && candidate.length > 0 && existsSync(candidate),
  );
  if (repositoryCommand) {
    return { command: repositoryCommand, repositoryManaged: true };
  }

  return { command: fallbackCommand, repositoryManaged: false };
}
