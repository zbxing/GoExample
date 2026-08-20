import { getProjectHealth } from '@/lib/api/management';
import { requireApiAccess } from '@/lib/server/auth-request';
import { privateJson } from '@/lib/server/response-security';

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { error } = await requireApiAccess(request);
  if (error) return error;

  const { projectId } = await context.params;
  const health = await getProjectHealth(projectId);

  if (!health) {
    return privateJson({ message: 'Project not found.' }, { status: 404 });
  }

  return privateJson(health);
}
