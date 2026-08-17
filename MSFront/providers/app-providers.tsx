'use client';

import { Suspense, type PropsWithChildren } from 'react';
import { AuthProvider } from '@/providers/auth-provider';
import { LocaleProvider } from '@/providers/locale-provider';
import { ThemeProvider } from '@/providers/theme-provider';
import { ProjectProvider, ProjectProviderFallback } from '@/providers/project-provider';

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <AuthProvider>
          <Suspense fallback={<ProjectProviderFallback>{children}</ProjectProviderFallback>}>
            <ProjectProvider>{children}</ProjectProvider>
          </Suspense>
        </AuthProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
