/**
 * Categorizacao por regras — CONTRACTS §6.
 *
 * Modulo puro (CONVENTIONS §5). A comparacao acontece sempre sobre a forma
 * normalizada da descricao (minuscula, sem acento, espacos colapsados, sem
 * sufixo de parcela), reusando `normalizeDescription` de `dedupe.ts`: uma regra
 * escrita como "mercado livre" tem de casar com "MERCADO LIVRE PARC 03/10" e
 * com "Mercado  Livre", senao ela so funciona no dia em que foi criada.
 */

import { normalizeDescription } from '@/lib/finance/dedupe';

export interface Rule {
  id: string;
  pattern: string;
  matchType: 'contains' | 'regex' | 'exact';
  categoryId: string;
  memberId: string | null;
  priority: number;
  active: boolean;
}

/** Resultado da categorizacao de uma linha. */
interface Categorization {
  categoryId: string;
  memberId: string | null;
  ruleId: string;
}

/**
 * Ordem de avaliacao: `priority` ascendente, `id` ascendente como desempate.
 * Duas regras com a mesma prioridade tem de resolver sempre igual, em qualquer
 * maquina — por isso o desempate por id, e nao a ordem em que vieram do banco.
 */
function byPriorityThenId(a: Rule, b: Rule): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Uma regra casa a descricao ja normalizada?
 *
 * Regex invalida NUNCA lanca: a regra e simplesmente ignorada. Uma regra
 * malformada nao pode derrubar a importacao inteira de uma fatura.
 */
function ruleMatches(rule: Rule, normalizedDescription: string): boolean {
  if (rule.matchType === 'regex') {
    let expression: RegExp;
    try {
      // 'i' e redundante com a descricao ja minuscula, mas perdoa a regra
      // escrita com maiuscula pelo usuario.
      expression = new RegExp(rule.pattern, 'i');
    } catch {
      return false;
    }
    return expression.test(normalizedDescription);
  }

  const pattern = normalizeDescription(rule.pattern);
  // Padrao vazio casaria com tudo em 'contains'. Uma regra sem padrao nao e
  // uma regra que pega tudo, e uma regra sem conteudo: nao casa nada.
  if (pattern === '') return false;

  return rule.matchType === 'exact'
    ? normalizedDescription === pattern
    : normalizedDescription.includes(pattern);
}

/** Regras ativas, na ordem de avaliacao. Nao muta a lista recebida. */
function evaluationOrder(rules: Rule[]): Rule[] {
  return rules.filter((rule) => rule.active).sort(byPriorityThenId);
}

/**
 * Primeira regra que casa a descricao, ou `null`.
 *
 * Regra inativa nunca casa. Regex invalida e ignorada e nao interrompe a
 * varredura: as regras seguintes continuam sendo avaliadas.
 */
export function matchRule(rules: Rule[], description: string): Rule | null {
  const normalized = normalizeDescription(description);
  for (const rule of evaluationOrder(rules)) {
    if (ruleMatches(rule, normalized)) return rule;
  }
  return null;
}

/**
 * Categoriza um lote de linhas. Linha que nao casa nenhuma regra fica FORA do
 * resultado — a ausencia da chave e o "nao categorizado", e e o que alimenta a
 * fila que o usuario revisa.
 *
 * As regras sao ordenadas uma vez para o lote inteiro, nao por linha.
 */
export function categorizeBatch(
  rules: Rule[],
  rows: { id: string; description: string }[],
): Record<string, Categorization> {
  const ordered = evaluationOrder(rules);
  const result: Record<string, Categorization> = {};

  for (const row of rows) {
    const normalized = normalizeDescription(row.description);
    const rule = ordered.find((candidate) => ruleMatches(candidate, normalized));
    if (rule === undefined) continue;
    result[row.id] = {
      categoryId: rule.categoryId,
      memberId: rule.memberId,
      ruleId: rule.id,
    };
  }

  return result;
}

/** O token final e codigo variavel (comeca por digito, ou nao tem letra)? */
function isTrailingCode(token: string): boolean {
  if (!/\d/.test(token)) return false;
  // Sem nenhuma letra e codigo puro ou data: "03/10", "12345".
  if (!/[a-z]/.test(token)) return true;
  // Comecando por digito e codigo de terminal: "8kdj2xy".
  return /^[^a-z]*\d/.test(token);
}

/**
 * Sugere o padrao de uma regra a partir de uma descricao real de cartao:
 * remove sufixo de parcela, data e codigo variavel do fim.
 *
 * O padrao devolvido e sempre um TRECHO CONTIGUO da descricao normalizada, e e
 * por isso que a limpeza so corta do fim. Se ela removesse um pedaco do meio,
 * o padrao deixaria de ser substring da descricao e a regra sugerida nao
 * casaria a propria linha que a originou — sugestao que nao casa a si mesma e
 * pior do que nenhuma sugestao. O teste trava essa invariante.
 *
 * Limite conhecido: codigo variavel que aparece no MEIO da descricao ("nf 1234
 * padaria") e preservado, porque corta-lo quebraria a contiguidade. O usuario
 * edita a sugestao antes de salvar.
 */
export function suggestRulePattern(rawDescription: string): {
  pattern: string;
  matchType: 'contains';
} {
  const normalized = normalizeDescription(rawDescription);
  const tokens = normalized.split(' ').filter((token) => token !== '');

  // Corta os codigos e datas do fim, sempre deixando pelo menos um token.
  while (tokens.length > 1 && isTrailingCode(tokens[tokens.length - 1] ?? '')) {
    tokens.pop();
  }

  const last = tokens[tokens.length - 1];
  if (last !== undefined) {
    // Digito colado no fim de uma palavra ("livre*3", "ifood-2"): tira so o
    // rabo numerico e mantem a palavra.
    tokens[tokens.length - 1] = last.replace(/[*#\-/]?\d+$/, '');
  }

  const pattern = tokens
    .join(' ')
    // Pontuacao solta na ponta nao ajuda a casar nada.
    .replace(/[^a-z0-9]+$/, '')
    .trim();

  // Se a limpeza comeu tudo (descricao so de digitos), a descricao normalizada
  // ainda e um padrao melhor do que string vazia, que nao casaria nada.
  return { pattern: pattern === '' ? normalized : pattern, matchType: 'contains' };
}
