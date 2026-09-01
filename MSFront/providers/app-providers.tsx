'use client';

import { Suspense, type PropsWithChildren } from 'react';
import { AuthProvider } from '@/providers/auth-provider';
import { LocaleProvider } from '@/providers/locale-provider';
import { ThemeProvider } from '@/providers/theme-provider';
import { ProjectProvider, ProjectProviderFallback } from '@/providers/project-provider';
import { FnaMessageHost } from '@/components/shell/fna-message-host';

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <AuthProvider>
          <Suspense fallback={<ProjectProviderFallback>{children}</ProjectProviderFallback>}>
            <ProjectProvider>{children}</ProjectProvider>
          </Suspense>
          <FnaMessageHost />
        </AuthProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
