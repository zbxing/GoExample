import { NextResponse } from 'next/server';
import { getAccessManagement } from '@/lib/api/management';
import {
  updateManagedUsersRoles,
  updateManagedUsersStatus,
} from '@/lib/server/access-management-repository';
import { requireApiAccess } from '@/lib/server/auth-request';
import { apiErrorResponse, readJsonBody } from '@/lib/server/request-body';
import { managedUserBatchSchema } from '@/lib/server/request-schemas';

export async function GET(request: Request) {
  const { error: accessError } = await requireApiAccess(request);
  if (accessError) return accessError;

  try {
    const accessManagement = await getAccessManagement();
    return NextResponse.json(accessManagement);
  } catch (error) {
    return apiErrorResponse(error, 'Failed to load access management users.');
  }
}

export async function PATCH(request: Request) {
  const { error: accessError } = await requireApiAccess(request);
  if (accessError) return accessError;

  try {
    const body = await readJsonBody(request, managedUserBatchSchema);

    if (body.action === 'batch-status') {
      const result = await updateManagedUsersStatus(body.userIds, body.status);
      return NextResponse.json(result);
    }

    if (body.action === 'batch-role') {
      const result = await updateManagedUsersRoles(body.userIds, body.roleId, body.operation);
      return NextResponse.json(result);
    }

    return NextResponse.json(
      {
        message: 'Unsupported batch user action.',
      },
      { status: 400 },
    );
  } catch (error) {
    return apiErrorResponse(error, 'Failed to update managed users in batch.', 400);
  }
}
