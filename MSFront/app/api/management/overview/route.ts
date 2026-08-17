import { NextResponse } from 'next/server';
import { getManagementOverview } from '@/lib/api/management';
import { requireApiAccess } from '@/lib/server/auth-request';

export async function GET(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) return error;

  const overview = await getManagementOverview();
  return NextResponse.json(overview);
}
