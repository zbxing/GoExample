import { SecurityPage } from '@/components/pages/security-page';
import { getSecurityGovernance } from '@/lib/api/management';
import { resolveSecurityFilterState } from '@/lib/utils/security-filters';

export const dynamic = 'force-dynamic';

export default async function SecurityRoute({
  searchParams,
}: {
  searchParams: Promise<{
    focus?: string;
    status?: string;
    role?: string;
    search?: string;
  }>;
}) {
  const governance = await getSecurityGovernance();
  const resolvedSearchParams = await searchParams;
  const initialFilters = resolveSecurityFilterState(
    resolvedSearchParams,
    governance.roles.map((role) => role.role),
  );
  const initialFocus = initialFilters.focus;
  const initialStatus = initialFilters.status;
  const initialRole = initialFilters.role;
  const initialSearch = initialFilters.search;
  const pageKey = `security:${initialFocus}:${initialStatus}:${initialRole}:${initialSearch}`;

  return (
    <SecurityPage
      key={pageKey}
      governance={governance}
      initialFocus={initialFocus}
      initialStatus={initialStatus}
      initialRole={initialRole}
      initialSearch={initialSearch}
    />
  );
}
