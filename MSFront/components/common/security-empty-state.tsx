'use client';

interface SecurityEmptyStateProps {
  title: string;
  description: string;
}

export function SecurityEmptyState({
  title,
  description,
}: SecurityEmptyStateProps) {
  return (
    <div className="emptyStatePanel">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
