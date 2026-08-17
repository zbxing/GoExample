import { NextResponse } from 'next/server';
import { deleteManagedRole, saveManagedRole } from '@/lib/server/access-management-repository';
import { requireApiAccess } from '@/lib/server/auth-request';
import { apiErrorResponse, readJsonBody } from '@/lib/server/request-body';
import { managedRoleUpdateSchema } from '@/lib/server/request-schemas';

export async function PUT(
  request: Request,
  context: {
    params: Promise<{
      roleId: string;
    }>;
  },
) {
  const { error: accessError } = await requireApiAccess(request);
  if (accessError) return accessError;

  try {
    const body = await readJsonBody(request, managedRoleUpdateSchema);
    const { roleId } = await context.params;
    const role = await saveManagedRole(roleId, {
      id: body.id || roleId,
      name: body.name,
      description: body.description,
      permissions: body.permissions,
    });

    return NextResponse.json(role);
  } catch (error) {
    return apiErrorResponse(error, 'Failed to save the managed role.', 400);
  }
}

export async function DELETE(
  request: Request,
  context: {
    params: Promise<{
      roleId: string;
    }>;
  },
) {
  const { error: accessError } = await requireApiAccess(request);
  if (accessError) return accessError;

  try {
    const { roleId } = await context.params;
    await deleteManagedRole(roleId);

    return NextResponse.json({ deleted: true, roleId });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to delete the managed role.', 400);
  }
}
