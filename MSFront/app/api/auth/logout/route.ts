import { jsonOk } from '@/lib/server/auth-request';
import { buildClearAuthCookie } from '@/lib/server/auth-token';

export async function POST() {
  const response = jsonOk({ ok: true });
  response.headers.set('Set-Cookie', buildClearAuthCookie());
  return response;
}
