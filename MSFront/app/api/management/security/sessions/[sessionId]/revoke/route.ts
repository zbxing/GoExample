import { NextResponse } from 'next/server';
import { revokeManagedSession } from '@/lib/server/access-management-repository';
import { requireApiAccess } from '@/lib/server/auth-request';
import { apiErrorResponse } from '@/lib/server/request-body';

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      sessionId: string;
    }>;
  },
) {
  const { error: accessError } = await requireApiAccess(request);
  if (accessError) return accessError;

  try {
    const { sessionId } = await context.params;
    const result = await revokeManagedSession(sessionId);

    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, 'Failed to revoke the managed session.', 400);
  }
}
