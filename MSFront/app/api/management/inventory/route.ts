import { NextResponse } from 'next/server';
import { readApiInventorySummary } from '@/lib/server/api-inventory';
import { requireApiAccess } from '@/lib/server/auth-request';

export async function GET(request: Request) {
  const { error } = await requireApiAccess(request);
  if (error) return error;

  const inventory = await readApiInventorySummary();

  if (!inventory) {
    return NextResponse.json({ message: 'API inventory is unavailable.' }, { status: 404 });
  }

  return NextResponse.json(inventory);
}
