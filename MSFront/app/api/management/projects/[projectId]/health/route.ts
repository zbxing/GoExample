import { NextResponse } from 'next/server';
import { getProjectHealth } from '@/lib/api/management';
import { requireApiAccess } from '@/lib/server/auth-request';

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { error } = await requireApiAccess(request);
  if (error) return error;

  const { projectId } = await context.params;
  const health = await getProjectHealth(projectId);

  if (!health) {
    return NextResponse.json({ message: 'Project not found.' }, { status: 404 });
  }

  return NextResponse.json(health);
}
