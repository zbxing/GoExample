'use client';

import { useEffect } from 'react';
import { CommandPaletteContent } from '@/components/shell/command-palette-content';
import { useCommandPaletteController } from '@/lib/utils/use-command-palette-controller';

export function CommandPalette({ openSignal = 0 }: { openSignal?: number }) {
  const controller = useCommandPaletteController();

  useEffect(() => {
    if (openSignal > 0 && !controller.isOpen) {
      controller.togglePalette();
    }
    // only react to external open signals
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);

  return <CommandPaletteContent {...controller} hideTrigger />;
}
