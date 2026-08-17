'use client';

interface SidebarSummaryContentProps {
  governanceCount: number;
  governanceLabel: string;
  projectCount: number;
  projectLabel: string;
  projectMeta: string;
  projectName: string;
  projectStatusLabel: string;
  workspaceCountLabel: string;
  workspaceEyebrow: string;
  workspaceTitle: string;
}

export function SidebarSummaryContent({
  governanceCount,
  governanceLabel,
  projectCount,
  projectLabel,
  projectMeta,
  projectName,
  projectStatusLabel,
  workspaceCountLabel,
  workspaceEyebrow,
  workspaceTitle,
}: SidebarSummaryContentProps) {
  return (
    <section className="sidebarSummary">
      <div className="sidebarSummaryHeader">
        <div>
          <span className="serviceCategory">{workspaceEyebrow}</span>
          <h2>{workspaceTitle}</h2>
        </div>
        <span className="securityTag">{workspaceCountLabel}</span>
      </div>

      <div className="summaryMetricList">
        <div>
          <span>{projectLabel}</span>
          <strong>{projectCount}</strong>
        </div>
        <div>
          <span>{governanceLabel}</span>
          <strong>{governanceCount}</strong>
        </div>
      </div>

      <p className="summaryFootnote">{projectStatusLabel}</p>
      <small>{projectName}</small>
      <small>{projectMeta}</small>
    </section>
  );
}
