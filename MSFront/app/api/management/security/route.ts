import { getSecurityGovernance } from '@/lib/api/management';
import { requireApiAccess } from '@/lib/server/auth-request';
import { privateJson } from '@/lib/server/response-security';

export async function GET(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) return error;

  const governance = await getSecurityGovernance();
  return privateJson(governance);
}
