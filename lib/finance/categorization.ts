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
import type { CategoryNature, TransactionKind } from '@/lib/finance/enum-mirrors';
import { addCents, type Cents } from '@/lib/money';

export interface Rule {
  id: string;
  pattern: string;
  matchType: 'contains' | 'regex' | 'exact';
  categoryId: string;
  memberId: string | null;
  priority: number;
  active: boolean;
  /**
   * Natureza da categoria da regra, quando quem chama a conhece. Com ela,
   * `groupUncategorized` nao usa a regra numa linha em que a categoria nao cabe
   * (`categoryFitsKind`). Ausente = sem essa conferencia.
   */
  categoryNature?: CategoryNature;
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

/**
 * Prefixo de cartao que a fatura poe no inicio ("[final 4239] IRMAOS BOA"). A
 * mesma loja aparece com e sem ele, conforme o cartao: deixa-lo no padrao faria
 * a regra nao casar a outra forma. Cortar do INICIO preserva a contiguidade.
 */
// `[^\]]*` e nao `\d+`: o parser do Mercado Pago grava "[final ?]" quando nao
// sabe o cartao.
const CARD_FINAL_PREFIX = /^\[final [^\]]*\]\s*/;

/** Carteira de pagamento no fim ("KaBuM! - NuPay"): e o meio, nao a loja. */
const PAYMENT_WALLET_SUFFIX = /\s*-\s*nupay$/;

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
 * Pelo mesmo motivo, os cortes especificos de fatura sao nas pontas: o prefixo
 * de cartao "[final NNNN]" no inicio e a carteira "- nupay" no fim.
 *
 * Unica excecao a invariante: descricao que e SO prefixo e/ou carteira devolve
 * padrao vazio, que significa "sem sugestao" — o usuario escreve o padrao.
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
  const merchant = normalized
    .replace(CARD_FINAL_PREFIX, '')
    .replace(PAYMENT_WALLET_SUFFIX, '');
  const tokens = merchant.split(' ').filter((token) => token !== '');

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

  // Se a limpeza dos codigos comeu tudo (descricao so de digitos), a loja sem
  // prefixo nem carteira ainda e um padrao melhor do que nada. Mas se nao sobra
  // loja nenhuma ("[final 4239]", "- nupay"), a resposta e string vazia = sem
  // sugestao: o que restaria casaria todas as compras do cartao ou da carteira.
  return { pattern: pattern === '' ? merchant.trim() : pattern, matchType: 'contains' };
}

/** Linha candidata a revisao de categoria. */
export interface CategorizationRow {
  id: string;
  description: string;
  amountCents: Cents;
  kind: TransactionKind;
  /** Null = nao categorizado. */
  categoryId: string | null;
}

/** Lancamentos que o usuario decide de uma vez so: mesma loja ou mesma regra. */
export interface UncategorizedGroup {
  /** Padrao da regra que ja casa o grupo, ou o sugerido por `suggestRulePattern`. */
  pattern: string;
  /** Na ordem em que as linhas chegaram. */
  ids: string[];
  /** Soma com sinal: despesa negativa, receita positiva. */
  totalCents: Cents;
  /** Regra ativa que ja casa o grupo; null = candidato a regra nova. */
  ruleId: string | null;
  /** Categoria da regra que ja casa; null quando o grupo nao tem regra. */
  suggestedCategoryId: string | null;
}

/**
 * A linha entra na revisao? Precisa estar sem categoria e ser gasto ou receita
 * de verdade. Ficam fora: pagamento de fatura (dinheiro ja contado nos itens da
 * fatura), transferencia e aporte de investimento (fora dos totais, RC-03), e
 * linha de valor zero (anuidade estornada, "saldo restante"), que nao muda
 * nenhum total — categoriza-las so poe ruido na fila.
 */
function isReviewable(row: CategorizationRow): boolean {
  return (
    row.categoryId === null &&
    (row.kind === 'expense' || row.kind === 'income') &&
    row.amountCents !== 0
  );
}

/** Saida antes de entrada; regra antes de sem regra; regra por id. */
function byGroupIdentity(a: UncategorizedGroup, b: UncategorizedGroup): number {
  const aOut = a.totalCents < 0;
  const bOut = b.totalCents < 0;
  if (aOut !== bOut) return aOut ? -1 : 1;
  if (a.ruleId === b.ruleId) return 0;
  if (a.ruleId === null) return 1;
  if (b.ruleId === null) return -1;
  return a.ruleId < b.ruleId ? -1 : 1;
}

/**
 * Agrupa as linhas sem categoria para a tela de revisao.
 *
 * Linha que uma regra ativa ja casa (regra criada depois da importacao) vai
 * para o grupo DAQUELA regra, ja com a categoria sugerida. As demais agrupam
 * pelo padrao de `suggestRulePattern`, que e o padrao que a regra nova teria.
 * Grupo de regra e grupo de padrao nunca se fundem, mesmo com o mesmo texto: um
 * ja tem destino, o outro ainda e decisao do usuario.
 *
 * Entrada e saida tambem nunca se fundem: Pix recebido e Pix enviado da mesma
 * pessoa tem naturezas diferentes e nao podem levar uma categoria so, e um
 * estorno somado a compra anularia o total e esconderia o grupo no fim da fila.
 * Por isso todo grupo tem um sinal so, e o total dele e tambem o seu tamanho.
 *
 * Ordem: maior |total| primeiro (o grupo que mais distorce os numeros vem no
 * topo); desempate por padrao, depois saida antes de entrada, depois grupo com
 * regra antes do sem regra — deterministico em qualquer maquina.
 */
export function groupUncategorized(
  rows: CategorizationRow[],
  rules: Rule[],
): UncategorizedGroup[] {
  const ordered = evaluationOrder(rules);
  const groups = new Map<string, UncategorizedGroup>();

  for (const row of rows) {
    if (!isReviewable(row)) continue;

    const normalized = normalizeDescription(row.description);
    // Regra cuja categoria nao cabe no tipo da linha (receita x despesa) e
    // pulada: sugerir Salario para um Pix enviado seria sugestao que o servidor
    // recusa. A proxima regra por prioridade ainda pode casar.
    const rule = ordered.find(
      (candidate) =>
        (candidate.categoryNature === undefined || categoryFitsKind(candidate.categoryNature, row.kind)) &&
        ruleMatches(candidate, normalized),
    );
    const pattern = rule === undefined ? suggestRulePattern(row.description).pattern : rule.pattern;
    // Prefixos distintos: um padrao nunca colide com o id de uma regra.
    const origin = rule === undefined ? `pattern:${pattern}` : `rule:${rule.id}`;
    const key = `${row.amountCents < 0 ? 'out' : 'in'}|${origin}`;

    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, {
        pattern,
        ids: [row.id],
        totalCents: row.amountCents,
        ruleId: rule === undefined ? null : rule.id,
        suggestedCategoryId: rule === undefined ? null : rule.categoryId,
      });
    } else {
      group.ids.push(row.id);
      group.totalCents = addCents(group.totalCents, row.amountCents);
    }
  }

  return [...groups.values()].sort((a, b) => {
    const bySize = Math.abs(b.totalCents) - Math.abs(a.totalCents);
    if (bySize !== 0) return bySize;
    if (a.pattern !== b.pattern) return a.pattern < b.pattern ? -1 : 1;
    return byGroupIdentity(a, b);
  });
}

/**
 * Ids das linhas que a regra categorizaria agora, para mostrar "esta regra pega
 * N lancamentos" antes de gravar.
 *
 * So linha SEM categoria: regra nunca sobrescreve categoria posta a mao. Mesmo
 * filtro da revisao (so gasto e receita, sem valor zero). Regra inativa,
 * padrao vazio e regex invalida devolvem lista vazia, nunca lancam.
 *
 * Avalia SO esta regra, sem a prioridade das outras: e a previa da regra nova.
 * Por isso quem grava tem de gravar EXATAMENTE estes ids. Rodar
 * `categorizeBatch` de novo deixaria uma regra antiga de prioridade maior pegar
 * a linha, e o "pega N" mostrado ao usuario ficaria errado.
 */
export function previewRule(rule: Rule, rows: CategorizationRow[]): string[] {
  if (!rule.active) return [];
  return rows
    .filter((row) => isReviewable(row) && ruleMatches(rule, normalizeDescription(row.description)))
    .map((row) => row.id);
}

/**
 * A categoria cabe no lancamento? Despesa nao vai para categoria de receita, e
 * receita so vai para categoria de receita. Os KPIs de receita e despesa somam
 * pelo `kind`, entao o total nao muda; o dano e outro: uma despesa numa
 * categoria `income` aparece no gasto por categoria e no orcamento debaixo de
 * uma categoria de receita, e some do "essencial" (que soma pela `nature`).
 *
 * Os demais tipos (transferencia, aporte, pagamento de fatura) nao passam pela
 * revisao de categoria e nao sao restringidos aqui.
 */
export function categoryFitsKind(nature: CategoryNature, kind: TransactionKind): boolean {
  if (kind === 'expense') return nature !== 'income';
  if (kind === 'income') return nature === 'income';
  return true;
}

/** Linha que o usuario acabou de categorizar a mao. */
export interface RuleOfferSource {
  id: string;
  description: string;
  kind: TransactionKind;
  categoryId: string;
}

/**
 * Oferta de regra depois de uma categorizacao manual (F5): "criar a regra
 * 'irmaos boa' -> Mercado?". Devolve o padrao e as OUTRAS linhas sem categoria
 * que a regra pegaria (previa: quem grava grava exatamente estes ids), ou
 * `null` quando nao ha o que oferecer:
 *
 * - nenhuma linha, ou linhas com categorias diferentes;
 * - linhas de lojas diferentes (padroes sugeridos distintos) — num lote de
 *   varias lojas, uma regra so nao representa a decisao;
 * - padrao sugerido vazio (descricao so de prefixo de cartao/carteira);
 * - categoria que nao cabe no tipo de alguma linha (`categoryFitsKind`);
 * - toda linha ja e coberta: a regra ativa vencedora, entre as que cabem no
 *   tipo, ja da essa categoria. Se a vencedora da OUTRA categoria, o usuario
 *   acabou de corrigi-la, e a oferta vale (a regra nova entra no topo).
 */
export function ruleOfferFor(input: {
  rules: Rule[];
  sources: RuleOfferSource[];
  categoryNature: CategoryNature;
  candidates: CategorizationRow[];
}): { pattern: string; matchingIds: string[] } | null {
  const [first] = input.sources;
  if (first === undefined) return null;
  if (input.sources.some((source) => source.categoryId !== first.categoryId)) return null;
  if (input.sources.some((source) => !categoryFitsKind(input.categoryNature, source.kind))) return null;

  const patterns = new Set(input.sources.map((source) => suggestRulePattern(source.description).pattern));
  const [pattern] = [...patterns];
  if (patterns.size !== 1 || pattern === undefined || pattern === '') return null;

  const covered = input.sources.every((source) => {
    const fitting = input.rules.filter(
      (rule) => rule.categoryNature === undefined || categoryFitsKind(rule.categoryNature, source.kind),
    );
    return matchRule(fitting, source.description)?.categoryId === first.categoryId;
  });
  if (covered) return null;

  const sourceIds = new Set(input.sources.map((source) => source.id));
  const offered: Rule = {
    id: 'offer',
    pattern,
    matchType: 'contains',
    categoryId: first.categoryId,
    memberId: null,
    priority: 0,
    active: true,
    categoryNature: input.categoryNature,
  };
  const others = input.candidates.filter(
    (row) => !sourceIds.has(row.id) && categoryFitsKind(input.categoryNature, row.kind),
  );
  return { pattern, matchingIds: previewRule(offered, others) };
}
