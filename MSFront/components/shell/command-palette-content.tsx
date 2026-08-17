'use client';

import {
  CommandPaletteShell,
  type CommandPaletteShellCopy,
} from '@/components/shell/command-palette-shell';
import { useLocale } from '@/providers/locale-provider';
import type { CommandPaletteController } from '@/lib/utils/use-command-palette-controller';

export function CommandPaletteContent(
  props: CommandPaletteController & { hideTrigger?: boolean },
) {
  const { t } = useLocale();
  const copy: CommandPaletteShellCopy = {
    activeBadge: t('commandPalette.activeBadge'),
    cancelLabel: t('actions.cancel'),
    description: t('commandPalette.description'),
    emptyDescription: t('commandPalette.emptyDescription'),
    emptyTitle: t('commandPalette.emptyTitle'),
    eyebrow: t('commandPalette.eyebrow'),
    openAriaLabel: t('commandPalette.openAriaLabel'),
    searchPlaceholder: '请输入你需要快捷到达的功能',
    shortcut: t('commandPalette.shortcut'),
    title: t('commandPalette.title'),
    trigger: t('commandPalette.trigger'),
  };

  return <CommandPaletteShell {...props} copy={copy} />;
}
