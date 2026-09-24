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
