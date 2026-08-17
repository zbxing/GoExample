import { NextResponse } from 'next/server';
import { updateManagedUser } from '@/lib/server/access-management-repository';
import { requireApiAccess } from '@/lib/server/auth-request';
import { apiErrorResponse, readJsonBody } from '@/lib/server/request-body';
import { managedUserUpdateSchema } from '@/lib/server/request-schemas';

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{
      userId: string;
    }>;
  },
) {
  const { error: accessError } = await requireApiAccess(request);
  if (accessError) return accessError;

  try {
    const body = await readJsonBody(request, managedUserUpdateSchema);
    const { userId } = await context.params;
    const user = await updateManagedUser(userId, body);

    return NextResponse.json(user);
  } catch (error) {
    return apiErrorResponse(error, 'Failed to update the managed user.', 400);
  }
}
