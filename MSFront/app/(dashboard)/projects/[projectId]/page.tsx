import { ProjectDetailPage } from '@/components/pages/project-detail-page';
import { getManagedProject, getProjectHealth } from '@/lib/api/management';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function ProjectDetailRoute({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [project, health] = await Promise.all([
    getManagedProject(projectId),
    getProjectHealth(projectId),
  ]);

  if (!project) {
    notFound();
  }

  return (
    <ProjectDetailPage
      project={project}
      health={health}
      generatedAt={new Date().toISOString()}
    />
  );
}
