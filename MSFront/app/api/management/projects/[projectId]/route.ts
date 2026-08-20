import { getManagedProject } from '@/lib/api/management';
import { deleteProject, updateProject } from '@/lib/server/project-repository';
import { requireApiAccess } from '@/lib/server/auth-request';
import { apiErrorResponse, readJsonBody } from '@/lib/server/request-body';
import { managedProjectDraftSchema } from '@/lib/server/request-schemas';
import { privateJson } from '@/lib/server/response-security';

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { error: accessError } = await requireApiAccess(request);
  if (accessError) return accessError;

  try {
    const { projectId } = await context.params;
    const project = await getManagedProject(projectId);

    if (!project) {
      return privateJson({ message: 'Project not found.' }, { status: 404 });
    }

    return privateJson(project);
  } catch (error) {
    return apiErrorResponse(error, 'Failed to load project.');
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { error: accessError } = await requireApiAccess(request);
  if (accessError) return accessError;

  try {
    const { projectId } = await context.params;
    const body = await readJsonBody(request, managedProjectDraftSchema);
    const project = await updateProject(projectId, body);

    if (!project) {
      return privateJson({ message: 'Project not found.' }, { status: 404 });
    }

    return privateJson(project);
  } catch (error) {
    return apiErrorResponse(error, 'Failed to update project.', 400);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { error: accessError } = await requireApiAccess(request);
  if (accessError) return accessError;

  try {
    const { projectId } = await context.params;
    const deleted = await deleteProject(projectId);

    if (!deleted) {
      return privateJson({ message: 'Project not found.' }, { status: 404 });
    }

    return privateJson({ success: true });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to delete project.');
  }
}
