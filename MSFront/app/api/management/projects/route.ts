import { NextResponse } from 'next/server';
import { getManagedProjectCatalog, getManagedProjectSummaries, getManagedProjects } from '@/lib/api/management';
import { createProject } from '@/lib/server/project-repository';
import { requireApiAccess } from '@/lib/server/auth-request';
import { apiErrorResponse, readJsonBody } from '@/lib/server/request-body';
import { managedProjectDraftSchema } from '@/lib/server/request-schemas';

export async function GET(request: Request) {
  const { error: accessError } = await requireApiAccess(request);
  if (accessError) return accessError;

  try {
    const url = new URL(request.url);
    const view = url.searchParams.get('view');

    if (view === 'catalog') {
      return NextResponse.json(await getManagedProjectCatalog());
    }

    if (view === 'summary' || url.searchParams.has('page')) {
      const result = await getManagedProjectSummaries({
        page: Number(url.searchParams.get('page') ?? 1),
        pageSize: Number(url.searchParams.get('pageSize') ?? 20),
        search: url.searchParams.get('search') ?? '',
        environment: (url.searchParams.get('environment') ?? 'all') as 'all' | 'production' | 'staging' | 'development',
        status: (url.searchParams.get('status') ?? 'all') as 'all' | 'healthy' | 'warning' | 'critical',
        sort: (url.searchParams.get('sort') ?? 'risk') as 'risk' | 'traffic' | 'deploy' | 'name',
      });
      return NextResponse.json(result);
    }

    return NextResponse.json(await getManagedProjects());
  } catch (error) {
    return apiErrorResponse(error, 'Failed to load projects.');
  }
}

export async function POST(request: Request) {
  const { error: accessError } = await requireApiAccess(request);
  if (accessError) return accessError;

  try {
    const body = await readJsonBody(request, managedProjectDraftSchema);
    const project = await createProject(body);
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to create project.', 400);
  }
}
