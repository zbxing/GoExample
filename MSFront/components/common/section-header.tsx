interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  description: string;
}

export function SectionHeader({ eyebrow, title, description }: SectionHeaderProps) {
  return (
    <div className="sectionHeader">
      {eyebrow ? <span className="sectionEyebrow">{eyebrow}</span> : null}
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
