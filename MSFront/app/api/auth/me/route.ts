import { jsonFail, requireSession } from '@/lib/server/auth-request';
import { jsonOk } from '@/lib/server/auth-request';

export async function GET(request: Request) {
  const { session, error } = await requireSession(request);
  if (error || !session) {
    return error ?? jsonFail('未登录', 401);
  }
  return jsonOk({ user: session });
}
