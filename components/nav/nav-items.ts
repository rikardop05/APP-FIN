import {
  CreditCard,
  LayoutDashboard,
  LineChart,
  ListChecks,
  Settings,
  Target,
  TrendingUp,
  Upload,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/**
 * As 9 rotas de SPEC §7, na ordem em que aparecem lá. Fonte única para a
 * navegação lateral (desktop) e inferior (celular) — as duas leem daqui, não
 * duplicam a lista.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Painel', icon: LayoutDashboard },
  { href: '/lancamentos', label: 'Lançamentos', icon: ListChecks },
  { href: '/importar', label: 'Importar', icon: Upload },
  { href: '/cartoes', label: 'Cartões', icon: CreditCard },
  { href: '/orcamento', label: 'Orçamento', icon: Wallet },
  { href: '/fluxo', label: 'Fluxo de caixa', icon: LineChart },
  { href: '/investimentos', label: 'Investimentos', icon: TrendingUp },
  { href: '/metas', label: 'Metas', icon: Target },
  { href: '/config', label: 'Configurações', icon: Settings },
];

/**
 * Item ativo é o de maior prefixo em comum: cobre sub-rotas como
 * `/orcamento/recorrentes`.
 *
 * O ramo `href === '/'` fica inerte até o T-115: o shell (SidebarNav/BottomNav)
 * não é montado em `/`, que ainda é a landing de `app/page.tsx` (T-001), fora
 * do grupo `(app)`. "Painel" nunca recebe `aria-current="page"` até lá — não é
 * bug, é consequência da posse do T-115 sobre `app/(app)/page.tsx`.
 */
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
