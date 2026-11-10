/**
 * Sugestao de receitas e despesas fixas pelo historico (Lote 2, item 8).
 *
 * Modulo puro (CONVENTIONS §5): recebe os lancamentos ja LANCADOS dos ultimos
 * meses e devolve candidatos a recorrencia. Nao grava nada e nao decide nada: a
 * tela mostra a evidencia e a pessoa confirma no formulario.
 *
 * ## O que e um candidato
 *
 * 1. **Janela**: os ultimos `HISTORY_MONTHS` (6) meses, contando o mes de
 *    `today`. O mes de uma linha e o da DATA DO FATO (`occurredOn`), nao a
 *    competencia da fatura: "todo dia 27" e sobre o dia em que aconteceu.
 * 2. **So receita e despesa.** Transferencia, pagamento de fatura e aporte nao
 *    sao renda nem gasto (RC-03) e nao viram recorrencia.
 * 3. **Parcela NAO e candidata**: ja esta no comprometido dos cartoes, e
 *    sugeri-la contaria o mesmo dinheiro duas vezes.
 * 4. **Receita precisa de conta**: o cadastro de receita exige a conta onde o
 *    dinheiro cai, entao entrada sem conta (estorno em cartao) fica de fora.
 * 5. **Mesma descricao**: a chave do grupo e o padrao de loja de
 *    `suggestRulePattern` (minuscula, sem acento, sem prefixo de cartao, sem
 *    codigo no fim), o mesmo que a categorizacao usa. Sem padrao, a descricao
 *    normalizada inteira. Receita e despesa nunca se misturam.
 * 6. **Valor dentro de 10%**: dentro do grupo, as linhas sao separadas em
 *    faixas de valor. Uma faixa comeca no menor valor e aceita ate 10% acima
 *    dele (`v * 10 <= base * 11`, em centavos inteiros). Assim "adiantamento" e
 *    "saldo" do mesmo pagador viram duas sugestoes, e nao uma media sem sentido.
 * 7. **Uma vez por mes**: faixa com duas linhas no mesmo mes nao e conta fixa
 *    (e mercado, e aplicativo de corrida) e e descartada inteira.
 * 8. **Meses distintos**: pelo menos `2`; pelo menos `3` quando o historico da
 *    casa na janela tem 3 meses ou mais. "Historico da casa" = meses distintos
 *    com alguma linha elegivel (itens 2 a 4).
 * 9. **Sem buraco grande**: do primeiro ao ultimo mes em que apareceu pode
 *    faltar no maximo UM mes. Conta bimestral ou trimestral fica de fora: a
 *    sugestao e sempre MENSAL, e sugerir mensal para o que nao e mensal
 *    inventaria despesa. Vale a sequencia MAIS RECENTE que cabe nessa regra:
 *    uma ocorrencia antiga isolada (junho, e depois setembro a novembro) e
 *    ignorada em vez de derrubar a sequencia, e nao entra na evidencia.
 * 10. **Ainda viva**: precisa ter aparecido no mes de `today` ou no anterior.
 *     Assinatura cancelada ha tres meses nao e sugerida.
 * 11. **Dia do mes proximo**: todo dia a no maximo `DAY_TOLERANCE` (5) dias do
 *     dia mediano. Cobre fim de semana e "quinto dia util". Limite conhecido: a
 *     distancia e linear, entao dia 30 e dia 1 contam como longe.
 * 12. **Ja cadastrada nao e sugerida**: grupo cuja chave e a de uma receita ou
 *     despesa fixa existente (`existing`), no mesmo sentido, e pulado.
 *
 * ## Um mes so de historico: nenhuma sugestao
 *
 * Decisao deste item. Com um mes, toda linha "apareceu uma vez" e a lista de
 * candidatos fracos seria o extrato inteiro: ruido que ensina a ignorar o
 * bloco. Uma ocorrencia nao e evidencia de repeticao. O bloco aparece a partir
 * do segundo mes.
 *
 * ## Mediana
 *
 * Valor e dia sugeridos sao a mediana INFERIOR (com numero par de linhas, a do
 * meio de baixo): sempre um valor que de fato ocorreu, nunca uma media com
 * meio centavo. No valor a mediana e a do MODULO, e o resultado sai com o sinal
 * do banco (despesa negativa).
 */

import { addCompetence, competenceStart, diffMonths, toCompetence, type Competence, type IsoDate } from '@/lib/date';
import { suggestRulePattern } from '@/lib/finance/categorization';
import { normalizeDescription } from '@/lib/finance/dedupe';
import type { TransactionKind } from '@/lib/finance/enum-mirrors';
import { cents, type Cents } from '@/lib/money';

/** Tamanho da janela de historico, em meses, contando o mes de `today`. */
export const HISTORY_MONTHS = 6;

/** Distancia maxima, em dias, entre o dia de uma ocorrencia e o dia mediano. */
const DAY_TOLERANCE = 5;

/** Linha `posted` do historico. Quem chama ja tirou o que veio de recorrencia cadastrada. */
export interface RecurrenceHistoryRow {
  occurredOn: IsoDate;
  /** Com o sinal do banco: saida negativa. */
  amountCents: Cents;
  description: string;
  kind: TransactionKind;
  categoryId: string | null;
  accountId: string | null;
  creditCardId: string | null;
  memberId: string | null;
  /** Parcela de um plano de parcelamento. */
  isInstallment: boolean;
}

/** Receita ou despesa fixa ja cadastrada (ativa ou nao): nao e sugerida de novo. */
export interface ExistingRecurrence {
  kind: 'income' | 'expense';
  description: string;
}

export interface RecurrenceSuggestion {
  /** Estavel entre chamadas com o mesmo historico: sentido, chave e menor valor da faixa. */
  key: string;
  kind: 'income' | 'expense';
  /** Descricao mais frequente entre as ocorrencias (empate: a mais recente). */
  description: string;
  /** Mediana inferior, com o sinal do banco. */
  medianCents: Cents;
  /** Dia do mes sugerido (mediana inferior), 1 a 31. */
  suggestedDay: number;
  /** Categoria mais frequente (empate: a mais recente); `null` se nenhuma ocorrencia tem categoria. */
  categoryId: string | null;
  /**
   * De onde sai (ou onde cai) o dinheiro, para preencher o formulario: o destino mais frequente,
   * conta OU cartao (nunca os dois). Receita tem sempre conta.
   */
  accountId: string | null;
  creditCardId: string | null;
  /** Responsavel mais frequente; `null` se nenhuma ocorrencia tem. */
  memberId: string | null;
  /** Meses em que apareceu, em ordem crescente. */
  months: Competence[];
}

/** Primeiro dia da janela de historico: a consulta le a partir daqui. */
export function recurrenceHistoryStart(today: IsoDate): IsoDate {
  return competenceStart(addCompetence(toCompetence(today), -(HISTORY_MONTHS - 1)));
}

function groupKey(description: string): string {
  const pattern = suggestRulePattern(description).pattern;
  return pattern === '' ? normalizeDescription(description) : pattern;
}

function isDirection(kind: TransactionKind): kind is 'income' | 'expense' {
  return kind === 'income' || kind === 'expense';
}

/** Mediana inferior de uma lista NAO vazia de inteiros. */
function lowerMedian(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  // `values` nunca e vazio aqui (faixa tem pelo menos uma linha).
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

/** Valor mais frequente; no empate, o da linha mais recente. `rows` vem em ordem crescente de data. */
function mostFrequent<T>(rows: readonly T[], pick: (row: T) => string | null): string | null {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = pick(row);
    if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  // De tras para a frente: no empate vence o que aparece na linha mais recente.
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row === undefined) continue;
    const value = pick(row);
    if (value === null) continue;
    const count = counts.get(value) ?? 0;
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function dayOfMonth(date: IsoDate): number {
  return Number(date.slice(8, 10));
}

export function suggestRecurrences(input: {
  today: IsoDate;
  rows: readonly RecurrenceHistoryRow[];
  existing: readonly ExistingRecurrence[];
}): RecurrenceSuggestion[] {
  const currentMonth = toCompetence(input.today);
  const firstMonth = addCompetence(currentMonth, -(HISTORY_MONTHS - 1));

  type Eligible = RecurrenceHistoryRow & { kind: 'income' | 'expense'; month: Competence; key: string };
  const eligible: Eligible[] = [];
  for (const row of input.rows) {
    const { kind } = row;
    if (!isDirection(kind)) continue;
    if (row.isInstallment) continue;
    if (kind === 'income' && row.accountId === null) continue;
    const month = toCompetence(row.occurredOn);
    if (month < firstMonth || month > currentMonth) continue;
    const key = groupKey(row.description);
    if (key === '') continue;
    eligible.push({ ...row, kind, month, key });
  }

  const historyMonths = new Set(eligible.map((row) => row.month)).size;
  // Um mes so: nenhuma sugestao (ver o cabecalho).
  if (historyMonths < 2) return [];
  const requiredMonths = historyMonths >= 3 ? 3 : 2;

  const registered = new Set(input.existing.map((item) => `${item.kind}|${groupKey(item.description)}`));

  const groups = new Map<string, Eligible[]>();
  for (const row of eligible) {
    const id = `${row.kind}|${row.key}`;
    if (registered.has(id)) continue;
    const list = groups.get(id);
    if (list === undefined) groups.set(id, [row]);
    else list.push(row);
  }

  const suggestions: RecurrenceSuggestion[] = [];
  for (const [id, group] of groups) {
    // Faixas de valor: ordena pelo modulo e abre faixa nova quando passa de 10% do menor da faixa.
    const byMagnitude = [...group].sort((a, b) => Math.abs(a.amountCents) - Math.abs(b.amountCents));
    const bands: Eligible[][] = [];
    for (const row of byMagnitude) {
      const band = bands[bands.length - 1];
      const base = band?.[0];
      if (band !== undefined && base !== undefined && Math.abs(row.amountCents) * 10 <= Math.abs(base.amountCents) * 11) {
        band.push(row);
      } else {
        bands.push([row]);
      }
    }

    for (const wholeBand of bands) {
      const base = wholeBand[0];
      if (base === undefined || base.amountCents === 0) continue;
      const allMonths = [...new Set(wholeBand.map((row) => row.month))].sort();
      // Duas linhas da faixa no mesmo mes: nao e conta fixa.
      if (allMonths.length !== wholeBand.length) continue;
      // Sequencia mais recente com no maximo um mes faltando entre o primeiro e o ultimo:
      // tira os meses mais antigos ate caber.
      let start = 0;
      const lastOfAll = allMonths[allMonths.length - 1];
      if (lastOfAll === undefined) continue;
      while (start < allMonths.length - 1) {
        const candidate = allMonths[start];
        if (candidate === undefined) break;
        const count = allMonths.length - start;
        if (diffMonths(lastOfAll, candidate) + 1 <= count + 1) break;
        start += 1;
      }
      const months = allMonths.slice(start);
      const band = wholeBand.filter((row) => months.includes(row.month));
      if (months.length < requiredMonths) continue;
      const last = months[months.length - 1];
      if (last === undefined) continue;
      // Ainda viva: apareceu neste mes ou no anterior.
      if (diffMonths(currentMonth, last) > 1) continue;
      const days = band.map((row) => dayOfMonth(row.occurredOn));
      const suggestedDay = lowerMedian(days);
      if (days.some((day) => Math.abs(day - suggestedDay) > DAY_TOLERANCE)) continue;

      const chronological = [...band].sort((a, b) => (a.occurredOn < b.occurredOn ? -1 : a.occurredOn > b.occurredOn ? 1 : 0));
      // Conta OU cartao, nunca os dois: o destino mais frequente entre as ocorrencias.
      const destination = mostFrequent(chronological, (row) =>
        row.accountId !== null ? `account:${row.accountId}` : row.creditCardId !== null ? `card:${row.creditCardId}` : null,
      );
      suggestions.push({
        key: `${id}|${String(Math.abs(base.amountCents))}`,
        kind: base.kind,
        description: mostFrequent(chronological, (row) => row.description) ?? base.description,
        // Mediana do MODULO, com o sinal do sentido: em despesa, "inferior" e o menor gasto.
        medianCents: cents(
          lowerMedian(band.map((row) => Math.abs(row.amountCents))) * (base.kind === 'expense' ? -1 : 1),
        ),
        suggestedDay,
        categoryId: mostFrequent(chronological, (row) => row.categoryId),
        accountId: destination?.startsWith('account:') ? destination.slice('account:'.length) : null,
        creditCardId: destination?.startsWith('card:') ? destination.slice('card:'.length) : null,
        memberId: mostFrequent(chronological, (row) => row.memberId),
        months,
      });
    }
  }

  // Receitas primeiro, depois o maior valor; a chave desempata para a ordem ser estavel.
  return suggestions.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'income' ? -1 : 1;
    const byValue = Math.abs(b.medianCents) - Math.abs(a.medianCents);
    if (byValue !== 0) return byValue;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}
