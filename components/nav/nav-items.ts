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
  /** No celular: `primary` = toque direto na barra inferior; `more` = atrás do botão "Mais". */
  mobile: 'primary' | 'more';
  /** Rótulo curto da barra inferior, onde 12px por 1/5 da largura não comporta o nome inteiro. */
  short?: string;
};

/**
 * As 9 rotas de SPEC §7, na ordem em que aparecem lá. Fonte única para a
 * navegação lateral (desktop) e inferior (celular) — as duas leem daqui, não
 * duplicam a lista.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Painel', icon: LayoutDashboard, mobile: 'primary' },
  { href: '/lancamentos', label: 'Lançamentos', icon: ListChecks, mobile: 'primary' },
  { href: '/importar', label: 'Importar', icon: Upload, mobile: 'more' },
  { href: '/cartoes', label: 'Cartões', icon: CreditCard, mobile: 'primary' },
  { href: '/orcamento', label: 'Orçamento', icon: Wallet, mobile: 'more' },
  { href: '/fluxo', label: 'Fluxo de caixa', short: 'Fluxo', icon: LineChart, mobile: 'primary' },
  { href: '/investimentos', label: 'Investimentos', icon: TrendingUp, mobile: 'more' },
  { href: '/metas', label: 'Metas', icon: Target, mobile: 'more' },
  { href: '/config', label: 'Configurações', icon: Settings, mobile: 'more' },
];

/**
 * Item ativo é o de maior prefixo em comum: cobre sub-rotas como
 * `/orcamento/recorrentes`.
 *
 * O ramo `href === '/'` exige a igualdade exata porque todo `href` começa com
 * `/`: com `startsWith`, "Painel" ficaria ativo em todas as rotas.
 */
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
