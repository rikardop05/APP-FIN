import type { MatchType, Nature } from './schemas';

/** Rotulos pt-BR (CONVENTIONS §1: identificador em ingles, texto visivel em pt-BR). */
export const natureLabel: Record<Nature, string> = {
  essential: 'Essencial',
  non_essential: 'Não essencial',
  investment: 'Investimento',
  income: 'Receita',
};

export const matchTypeLabel: Record<MatchType, string> = {
  contains: 'Contém',
  regex: 'Expressão regular',
  exact: 'Igual a',
};

/** "1 subcategoria" / "3 subcategorias": o número manda no plural, nunca "(s)". */
export function subcategoriesText(count: number): string {
  return `${String(count)} ${count === 1 ? 'subcategoria' : 'subcategorias'}`;
}

/** As seções da tela, na ordem, com a âncora de cada uma (o menu do topo e os `id` usam esta lista). */
export const CONFIG_SECTIONS = [
  { id: 'categorias', label: 'Categorias' },
  { id: 'regras', label: 'Regras' },
  { id: 'membros', label: 'Membros' },
  { id: 'premissas', label: 'Premissas' },
  { id: 'backup', label: 'Backup' },
] as const;
