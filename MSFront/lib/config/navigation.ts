import type { Route } from 'next';
import {
  Boxes,
  Cable,
  LayoutDashboard,
  Network,
  ShieldAlert,
  Settings,
  Shield,
  ShieldCheck,
  Users,
} from 'lucide-react';

export interface NavigationItem {
  href: Route;
  icon: typeof LayoutDashboard;
  translationKey: string;
}

export const navigationItems: NavigationItem[] = [
  {
    href: '/dashboard',
    icon: LayoutDashboard,
    translationKey: 'nav.dashboard',
  },
  {
    href: '/system/users',
    icon: Users,
    translationKey: 'labels.users',
  },
  {
    href: '/system/roles',
    icon: ShieldAlert,
    translationKey: 'labels.roles',
  },
  {
    href: '/projects',
    icon: Boxes,
    translationKey: 'nav.projects',
  },
  {
    href: '/services',
    icon: ShieldCheck,
    translationKey: 'nav.services',
  },
  {
    href: '/environments',
    icon: Network,
    translationKey: 'nav.environments',
  },
  {
    href: '/integrations',
    icon: Cable,
    translationKey: 'nav.integrations',
  },
  {
    href: '/security',
    icon: Shield,
    translationKey: 'nav.security',
  },
  {
    href: '/settings',
    icon: Settings,
    translationKey: 'nav.settings',
  },
];
