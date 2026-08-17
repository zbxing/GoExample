import 'server-only';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectoryPath = path.dirname(currentFilePath);

export const msFrontRootPath = path.resolve(currentDirectoryPath, '..', '..');
export const workspaceRootPath = path.resolve(msFrontRootPath, '..');
