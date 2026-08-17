'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Users,
} from 'lucide-react';
import { EditorSection } from '@/components/common/editor-section';
import type { RolesEditorMembersSectionModel } from '@/lib/utils/use-roles-page-editor-presentation-controller';

interface RolesEditorMembersContentProps {
  membersSection: RolesEditorMembersSectionModel;
}

export function RolesEditorMembersContent({
  membersSection,
}: RolesEditorMembersContentProps) {
  return (
    <EditorSection icon={<Users size={16} />} title={membersSection.title}>
      {membersSection.cards.length === 0 ? (
        <div className="emptyStatePanel">
          <strong>{membersSection.emptyTitle}</strong>
          <p>{membersSection.emptyDescription}</p>
        </div>
      ) : (
        <div className="accessMemberList">
          {membersSection.cards.map((member) => (
            <article key={member.id} className="entityCard">
              <div className="entityCardHeader">
                <div>
                  <strong>{member.displayName}</strong>
                  <span className="securityTag">{member.usernameLabel}</span>
                </div>
                <Link href={member.memberHref} className="secondaryButton">
                  {membersSection.openMemberLabel}
                  <ArrowRight size={14} />
                </Link>
                <Link href={member.securityHref} className="securityInlineLink">
                  {membersSection.openMemberSecurityLabel}
                </Link>
              </div>
              <div className="tagList">
                {member.tags.map((tag) => (
                  <span key={tag.id} className="securityTag">
                    {tag.label}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </EditorSection>
  );
}

export type { RolesEditorMembersSectionModel };
