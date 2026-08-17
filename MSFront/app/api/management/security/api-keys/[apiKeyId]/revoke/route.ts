import { NextResponse } from 'next/server';
import { revokeManagedApiKey } from '@/lib/server/access-management-repository';
import { requireApiAccess } from '@/lib/server/auth-request';
import { apiErrorResponse } from '@/lib/server/request-body';

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      apiKeyId: string;
    }>;
  },
) {
  const { error: accessError } = await requireApiAccess(request);
  if (accessError) return accessError;

  try {
    const { apiKeyId } = await context.params;
    const result = await revokeManagedApiKey(apiKeyId);

    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, 'Failed to revoke the managed API key.', 400);
  }
}
