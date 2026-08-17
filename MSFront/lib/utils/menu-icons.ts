import {
  Boxes,
  Cable,
  CircleHelp,
  Code2,
  KeyRound,
  LayoutDashboard,
  Menu,
  Network,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';

const iconMap: Record<string, LucideIcon> = {
  LayoutDashboard,
  ShieldCheck,
  Users,
  ShieldAlert,
  Menu,
  Code2,
  KeyRound,
  Boxes,
  Network,
  Cable,
  Shield,
  Settings,
  CircleHelp,
};

export function resolveMenuIcon(iconName: string): LucideIcon {
  return iconMap[iconName] ?? CircleHelp;
}
