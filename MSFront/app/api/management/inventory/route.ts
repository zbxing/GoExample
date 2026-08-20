import { readApiInventorySummary } from '@/lib/server/api-inventory';
import { requireApiAccess } from '@/lib/server/auth-request';
import { privateJson } from '@/lib/server/response-security';

export async function GET(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) return error;

  const inventory = await readApiInventorySummary();

  if (!inventory) {
    return privateJson({ message: 'API inventory is unavailable.' }, { status: 404 });
  }

  return privateJson(inventory);
}
