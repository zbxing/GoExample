import { validateAuthTokenConfiguration } from '@/lib/server/auth-token';
import { validateTrustedMutationOrigins } from '@/lib/server/request-security';

export function register() {
  // Next invokes instrumentation for every runtime; authentication configuration
  // is validated only by the Node.js server that owns the route handlers.
  if (process.env.NEXT_RUNTIME === 'edge') {
    return;
  }

  validateAuthTokenConfiguration();
  validateTrustedMutationOrigins();
}
