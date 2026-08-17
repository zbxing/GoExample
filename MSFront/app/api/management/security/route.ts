import { NextResponse } from 'next/server';
import { getSecurityGovernance } from '@/lib/api/management';
import { requireApiAccess } from '@/lib/server/auth-request';

export async function GET(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) return error;

  const governance = await getSecurityGovernance();
  return NextResponse.json(governance);
}
