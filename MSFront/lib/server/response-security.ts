import 'server-only';

import { NextResponse } from 'next/server';

export function disableResponseCaching<T extends Response>(response: T) {
  response.headers.set('Cache-Control', 'no-store, no-transform');
  response.headers.set('Pragma', 'no-cache');
  return response;
}

export function privateJson<T>(body: T, init?: ResponseInit) {
  return disableResponseCaching(NextResponse.json(body, init));
}
