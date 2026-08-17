'use client';

import type { Route } from 'next';
import {
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import {
  Boxes,
  Globe2,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { navigationItems } from '@/lib/config/navigation';
import { siteConfig } from '@/lib/config/site';
import {
  buildContextualShellHref,
  buildProjectSelectionSurfaceHref,
} from '@/lib/utils/shell-navigation';
import { describeWorkspaceRoute } from '@/lib/utils/workspace-surface';
import type { ManagedProjectCatalogEntry, ThemeMode } from '@/lib/types/management';
import { useLocale } from '@/providers/locale-provider';
import { useProjectSelection } from '@/providers/project-provider';
import { useTheme } from '@/providers/theme-provider';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

export interface CommandPaletteItemModel {
  active: boolean;
  description: string;
  icon: LucideIcon;
  id: string;
  matchText: string;
  onSelect: () => void;
  title: string;
}

export interface CommandPaletteGroupModel {
  id: string;
  items: readonly CommandPaletteItemModel[];
  title: string;
}

export interface CommandPaletteController {
  activeItemId: string;
  closePalette: (options?: { restoreFocus?: boolean }) => void;
  dialogId: string;
  filteredGroups: readonly CommandPaletteGroupModel[];
  getItemDomId: (itemId: string) => string;
  handleItemHover: (itemId: string) => void;
  handlePanelKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  handleSearchChange: (value: string) => void;
  handleSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  isOpen: boolean;
  liveRegionMessage: string;
  panelRef: RefObject<HTMLElement | null>;
  query: string;
  resultsId: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  statusId: string;
  titleId: string;
  togglePalette: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

export function useCommandPaletteController(): CommandPaletteController {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale, setLocale, t } = useLocale();
  const { theme, setTheme } = useTheme();
  const { projects, selectedProject, selectedProjectId, setSelectedProjectId } =
    useProjectSelection();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeItemId, setActiveItemId] = useState('');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const dialogId = useId();
  const titleId = useId();
  const resultsId = useId();
  const statusId = useId();

  function openPalette() {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : triggerRef.current;
    setIsOpen(true);
  }

  function closePalette(options?: { restoreFocus?: boolean }) {
    setQuery('');
    setIsOpen(false);
    setActiveItemId('');

    if (options?.restoreFocus === false) {
      previousFocusRef.current = null;
      return;
    }

    const nextFocusTarget = previousFocusRef.current ?? triggerRef.current;
    previousFocusRef.current = null;

    if (nextFocusTarget) {
      requestAnimationFrame(() => {
        nextFocusTarget.focus();
      });
    }
  }

  function togglePalette() {
    if (isOpen) {
      closePalette();
      return;
    }

    openPalette();
  }

  const handlePaletteHotkey = useEffectEvent((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      togglePalette();
    }

    if (event.key === 'Escape') {
      closePalette();
    }
  });

  useEffect(() => {
    window.addEventListener('keydown', handlePaletteHotkey);

    return () => {
      window.removeEventListener('keydown', handlePaletteHotkey);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  const groups = useMemo(
    () =>
      buildCommandPaletteGroups({
        locale,
        pathname,
        projects,
        router,
        searchParams: new URLSearchParams(searchParams.toString()),
        selectedProject,
        selectedProjectId,
        setLocale,
        setSelectedProjectId,
        setTheme,
        t,
        theme,
      }),
    [
      locale,
      pathname,
      projects,
      router,
      searchParams,
      selectedProject,
      selectedProjectId,
      setLocale,
      setSelectedProjectId,
      setTheme,
      t,
      theme,
    ],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filteredGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        !normalizedQuery || item.matchText.toLowerCase().includes(normalizedQuery),
      ),
    }))
    .filter((group) => group.items.length > 0);
  const filteredItems = filteredGroups.flatMap((group) => group.items);
  const resolvedActiveItemId =
    activeItemId && filteredItems.some((item) => item.id === activeItemId)
      ? activeItemId
      : resolveDefaultActiveItemId(filteredItems);
  const activeItem = filteredItems.find((item) => item.id === resolvedActiveItemId) ?? null;
  const liveRegionMessage =
    filteredGroups.length === 0
      ? `${t('commandPalette.emptyTitle')}. ${t('commandPalette.emptyDescription')}`
      : activeItem
        ? `${activeItem.title}. ${activeItem.description}`
        : '';

  useEffect(() => {
    if (!isOpen || !resolvedActiveItemId) {
      return;
    }

    const activeElement = document.getElementById(
      buildCommandPaletteItemDomId(resultsId, resolvedActiveItemId),
    );
    activeElement?.scrollIntoView({
      block: 'nearest',
    });
  }, [isOpen, resolvedActiveItemId, resultsId]);

  function moveActiveItem(direction: 1 | -1) {
    if (filteredItems.length === 0) {
      return;
    }

    const currentIndex = filteredItems.findIndex((item) => item.id === resolvedActiveItemId);
    const nextIndex =
      currentIndex === -1
        ? direction === 1
          ? 0
          : filteredItems.length - 1
        : (currentIndex + direction + filteredItems.length) % filteredItems.length;

    setActiveItemId(filteredItems[nextIndex]?.id ?? '');
  }

  function focusBoundaryItem(position: 'first' | 'last') {
    if (filteredItems.length === 0) {
      return;
    }

    setActiveItemId(
      position === 'first' ? filteredItems[0]?.id ?? '' : filteredItems[filteredItems.length - 1]?.id ?? '',
    );
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActiveItem(1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActiveItem(-1);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      focusBoundaryItem('first');
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      focusBoundaryItem('last');
      return;
    }

    if (event.key === 'Enter' && activeItem) {
      event.preventDefault();
      activeItem.onSelect();
      closePalette({ restoreFocus: false });
    }
  }

  function handlePanelKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') {
      return;
    }

    const focusableElements = panelRef.current
      ? Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled])',
          ),
        ).filter((element) => !element.hasAttribute('aria-hidden'))
      : [];

    if (focusableElements.length === 0) {
      return;
    }

    const currentIndex = focusableElements.findIndex((element) => element === document.activeElement);
    const nextIndex = event.shiftKey
      ? currentIndex <= 0
        ? focusableElements.length - 1
        : currentIndex - 1
      : currentIndex === -1 || currentIndex === focusableElements.length - 1
        ? 0
        : currentIndex + 1;

    if (
      currentIndex === -1 ||
      (!event.shiftKey && currentIndex === focusableElements.length - 1) ||
      (event.shiftKey && currentIndex === 0)
    ) {
      event.preventDefault();
      focusableElements[nextIndex]?.focus();
    }
  }

  function handleSearchChange(value: string) {
    setQuery(value);
  }

  function handleItemHover(itemId: string) {
    setActiveItemId(itemId);
  }

  return {
    activeItemId: resolvedActiveItemId,
    closePalette,
    dialogId,
    filteredGroups,
    getItemDomId: (itemId: string) => buildCommandPaletteItemDomId(resultsId, itemId),
    handleItemHover,
    handlePanelKeyDown,
    handleSearchChange,
    handleSearchKeyDown,
    isOpen,
    liveRegionMessage,
    panelRef,
    query,
    resultsId,
    searchInputRef,
    statusId,
    titleId,
    togglePalette,
    triggerRef,
  };
}

function buildCommandPaletteGroups({
  locale,
  pathname,
  projects,
  router,
  searchParams,
  selectedProject,
  selectedProjectId,
  setLocale,
  setSelectedProjectId,
  setTheme,
  t,
  theme,
}: {
  locale: string;
  pathname: string;
  projects: readonly ManagedProjectCatalogEntry[];
  router: ReturnType<typeof useRouter>;
  searchParams: URLSearchParams;
  selectedProject: ManagedProjectCatalogEntry | null;
  selectedProjectId: string;
  setLocale: (locale: typeof siteConfig.locales[number]) => void;
  setSelectedProjectId: (projectId: string) => void;
  setTheme: (theme: ThemeMode) => void;
  t: TranslationFn;
  theme: ThemeMode;
}): CommandPaletteGroupModel[] {
  return [
    {
      id: 'navigation',
      title: t('commandPalette.groups.navigation'),
      items: navigationItems.map((item) => ({
        active: pathname === item.href || pathname.startsWith(`${item.href}/`),
        description: describeWorkspaceRoute(item.href, t),
        icon: item.icon,
        id: `nav:${item.href}`,
        matchText: `${t(item.translationKey)} ${describeWorkspaceRoute(item.href, t)} ${item.href}`,
        onSelect: () => {
          router.push(
            buildContextualShellHref({
              route: item.href,
              pathname,
              searchParams: new URLSearchParams(searchParams.toString()),
              project: selectedProject,
            }) as Route,
          );
        },
        title: t(item.translationKey),
      })),
    },
    {
      id: 'projects',
      title: t('commandPalette.groups.projects'),
      items: projects.map((project) => ({
        active: selectedProjectId === project.id,
        description: `${project.code} / ${project.owner} / ${t(`status.${project.environment}`)}`,
        icon: Boxes,
        id: `project:${project.id}`,
        matchText: [
          project.name,
          project.code,
          project.owner,
          project.region,
          project.environment,
          project.status,
          ...project.tags,
        ].join(' '),
        onSelect: () => {
          setSelectedProjectId(project.id);
          const nextHref = buildProjectSelectionSurfaceHref({
            pathname,
            searchParams: new URLSearchParams(searchParams.toString()),
            project,
            availableProjectIds: projects.map((item) => item.id),
          });

          if (nextHref) {
            router.push(nextHref as Route);
          }
        },
        title: project.name,
      })),
    },
    {
      id: 'workspace',
      title: t('commandPalette.groups.workspace'),
      items: [
        ...siteConfig.locales.map((item) => ({
          active: locale === item,
          description: t('commandPalette.descriptions.locale'),
          icon: Globe2,
          id: `locale:${item}`,
          matchText: `${item} ${t(`common.locales.${item}`)}`,
          onSelect: () => {
            setLocale(item);
          },
          title: t('commandPalette.actions.switchLocale', {
            locale: t(`common.locales.${item}`),
          }),
        })),
        ...siteConfig.themes.map((item) => ({
          active: theme === item,
          description: t('commandPalette.descriptions.theme'),
          icon: item === 'system' ? Settings : ShieldCheck,
          id: `theme:${item}`,
          matchText: `${item} ${t(`common.themes.${item}`)}`,
          onSelect: () => {
            setTheme(item);
          },
          title: t('commandPalette.actions.switchTheme', {
            theme: t(`common.themes.${item}`),
          }),
        })),
      ],
    },
  ];
}

function resolveDefaultActiveItemId(items: readonly CommandPaletteItemModel[]) {
  return items.find((item) => item.active)?.id ?? items[0]?.id ?? '';
}

function buildCommandPaletteItemDomId(resultsId: string, itemId: string) {
  return `${resultsId}-${itemId}`;
}
