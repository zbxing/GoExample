import 'server-only';
import { fiberSystemAdapter } from '@/lib/api/fiber-system-adapter';
import { localSystemAdapter } from '@/lib/api/local-system-adapter';
import { resolveSystemBackendMode, type SystemAdapter } from '@/lib/api/system-adapter';

export function getSystemAdapter(): SystemAdapter {
  return resolveSystemBackendMode() === 'fiber' ? fiberSystemAdapter : localSystemAdapter;
}
