import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseApiInventoryDocument } from '@/lib/server/api-inventory-parser';
import { workspaceRootPath } from '@/lib/server/runtime-paths';

const inventoryFilePath = path.join(
  /* turbopackIgnore: true */ workspaceRootPath,
  'docs',
  'openapi',
  'openapi.json',
);

export async function readApiInventorySummary() {
  try {
    const content = await readFile(inventoryFilePath, 'utf8');
    return parseApiInventoryDocument(JSON.parse(content));
  } catch {
    return null;
  }
}
