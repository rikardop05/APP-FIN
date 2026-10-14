import {
  CalendarClock,
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

/** Seções do menu, na ordem: o que se vê agora, o que vem adiante e a régua de configuração. */
export type NavGroupKey = 'mes' | 'adiante' | 'config';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** No celular: `primary` = toque direto na barra inferior; `more` = atrás do botão "Mais". */
  mobile: 'primary' | 'more';
  /** Rótulo curto da barra inferior, onde 12px por 1/5 da largura não comporta o nome inteiro. */
  short?: string;
  /** Seção da lombada e do painel "Mais" em que o item aparece. */
  group: NavGroupKey;
};

/**
 * Rotas autenticadas, agrupadas: "Mês" o que se opera agora, "Adiante" a projeção e "Config" a
 * configuração. Fonte única para a navegação lateral (desktop) e inferior (celular) — as duas leem
 * daqui, não duplicam a lista.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Painel', icon: LayoutDashboard, mobile: 'primary', group: 'mes' },
  { href: '/lancamentos', label: 'Lançamentos', icon: ListChecks, mobile: 'primary', group: 'mes' },
  { href: '/importar', label: 'Importar', icon: Upload, mobile: 'more', group: 'mes' },
  { href: '/cartoes', label: 'Cartões', icon: CreditCard, mobile: 'primary', group: 'mes' },
  { href: '/fluxo', label: 'Fluxo de caixa', short: 'Fluxo', icon: LineChart, mobile: 'primary', group: 'adiante' },
  { href: '/orcamento', label: 'Orçamento', icon: Wallet, mobile: 'more', group: 'adiante' },
  {
    href: '/orcamento/recorrentes',
    label: 'Receitas e despesas fixas',
    icon: CalendarClock,
    mobile: 'more',
    group: 'adiante',
  },
  { href: '/metas', label: 'Metas', icon: Target, mobile: 'more', group: 'adiante' },
  { href: '/investimentos', label: 'Investimentos', icon: TrendingUp, mobile: 'more', group: 'adiante' },
  { href: '/config', label: 'Configurações', icon: Settings, mobile: 'more', group: 'config' },
];

export type NavGroup = {
  key: NavGroupKey;
  label: string;
  items: readonly NavItem[];
};

const GROUP_LABEL: Record<NavGroupKey, string> = { mes: 'Mês', adiante: 'Adiante', config: 'Config' };
const GROUP_ORDER: readonly NavGroupKey[] = ['mes', 'adiante', 'config'];

/**
 * Os itens repartidos pelas seções rotuladas. Sempre as três seções, mesmo que alguma venha vazia
 * (hoje não vem; amanhã sim, o rótulo continua explicando o menu).
 */
export function navGroups(items: readonly NavItem[] = NAV_ITEMS): readonly NavGroup[] {
  return GROUP_ORDER.map((key) => ({
    key,
    label: GROUP_LABEL[key],
    items: items.filter((item) => item.group === key),
  }));
}

export const NAV_GROUPS: readonly NavGroup[] = navGroups();

/**
 * Item ativo é o de maior prefixo em comum: cobre sub-rotas como `/orcamento/recorrentes`. Com os
 * dois agora no menu, só o mais longo leva `aria-current` — senão "Orçamento" e "Receitas e despesas
 * fixas" acenderiam juntos.
 *
 * O ramo `href === '/'` exige a igualdade exata porque todo `href` começa com
 * `/`: com `startsWith`, "Painel" ficaria ativo em todas as rotas.
 */
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** O item de navegação cuja rota é a maior casa do `pathname` (`null` fora do menu). */
export function activeNavItemHref(pathname: string): string | null {
  let best: string | null = null;
  for (const item of NAV_ITEMS) {
    if (!isNavItemActive(item.href, pathname)) continue;
    if (best === null || item.href.length > best.length) best = item.href;
  }
  return best;
}
