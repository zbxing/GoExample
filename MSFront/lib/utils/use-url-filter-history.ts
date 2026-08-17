'use client';

import { useEffect, useEffectEvent, useRef } from 'react';

interface UseUrlFilterHistoryOptions<TState> {
  enabled?: boolean;
  pathname: string;
  currentState: TState;
  getCurrentHref: (currentSearch: string) => string;
  syncFromUrl: (searchParams: URLSearchParams) => void;
  shouldPushHistory: (previousState: TState | null, nextState: TState) => boolean;
}

export function useUrlFilterHistory<TState>({
  enabled = true,
  pathname,
  currentState,
  getCurrentHref,
  syncFromUrl,
  shouldPushHistory,
}: UseUrlFilterHistoryOptions<TState>) {
  const lastCommittedHrefRef = useRef<string | null>(null);
  const lastCommittedStateRef = useRef<TState | null>(null);
  const skipHistorySyncRef = useRef(false);
  const handleSyncFromUrl = useEffectEvent((searchParams: URLSearchParams) => {
    syncFromUrl(searchParams);
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const currentHref = getCurrentHref(window.location.search);
    const routeBase = currentHref.split('?')[0] || pathname;
    const nextUrl =
      currentHref === routeBase ? pathname : `${pathname}${currentHref.slice(routeBase.length)}`;
    const currentUrl = `${pathname}${window.location.search}`;

    if (skipHistorySyncRef.current) {
      skipHistorySyncRef.current = false;
      lastCommittedHrefRef.current = currentHref;
      lastCommittedStateRef.current = currentState;
      return;
    }

    if (lastCommittedHrefRef.current === null) {
      if (nextUrl !== currentUrl) {
        window.history.replaceState(window.history.state, '', nextUrl);
      }

      lastCommittedHrefRef.current = currentHref;
      lastCommittedStateRef.current = currentState;
      return;
    }

    if (currentHref === lastCommittedHrefRef.current) {
      return;
    }

    if (nextUrl !== currentUrl) {
      const historyMethod = shouldPushHistory(lastCommittedStateRef.current, currentState)
        ? window.history.pushState
        : window.history.replaceState;

      historyMethod.call(window.history, window.history.state, '', nextUrl);
    }

    lastCommittedHrefRef.current = currentHref;
    lastCommittedStateRef.current = currentState;
  }, [currentState, enabled, getCurrentHref, pathname, shouldPushHistory]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handlePopState = () => {
      skipHistorySyncRef.current = true;
      handleSyncFromUrl(new URLSearchParams(window.location.search));
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [enabled]);
}
