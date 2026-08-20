import { getAccessManagement } from '@/lib/api/management';
import { createManagedRole } from '@/lib/server/access-management-repository';
import { requireApiAccess } from '@/lib/server/auth-request';
import { apiErrorResponse, readJsonBody } from '@/lib/server/request-body';
import { managedRoleCreateSchema } from '@/lib/server/request-schemas';
import { privateJson } from '@/lib/server/response-security';

export async function GET(request: Request) {
  const { error: accessError } = await requireApiAccess(request);
  if (accessError) return accessError;

  try {
    const accessManagement = await getAccessManagement();
    return privateJson(accessManagement);
  } catch (error) {
    return apiErrorResponse(error, 'Failed to load access management roles.');
  }
}

export async function POST(request: Request) {
  const { error: accessError } = await requireApiAccess(request);
  if (accessError) return accessError;

  try {
    const body = await readJsonBody(request, managedRoleCreateSchema);
    const role = await createManagedRole(body);

    return privateJson(role, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to create the managed role.', 400);
  }
}
