/**
 * Pipeline de preview e confirmacao da importacao — CONTRACTS §15
 * (`buildImportPreview`) e §16 (`finalizeImport`), T-107.
 *
 * E o que a rota de API chama: junta o resultado de qualquer parser (PDF ou
 * texto colado) com competencia, dedupe, categorizacao e deteccao de parcela, e
 * depois converte as linhas **confirmadas** pelo usuario no que sera gravado.
 *
 * ## O desempate parcela x data (a razao desta tarefa existir)
 *
 * `detectInstallment` (T-121) recebe so a descricao e nao tem como saber a data.
 * Um par `N/M` — `03/10` — pode ser "parcela 3 de 10" ou "3 de outubro". Aqui as
 * duas informacoes existem juntas, entao o desempate e uma comparacao: se
 * `N === dia` e `M === mes` do `occurredOn` da propria linha, e **data**, nao
 * parcela. Sem isso, cerca de 1 em 5 datas `dd/mm` viram parcela fantasma,
 * projetada por M meses no comprometimento futuro.
 *
 * ## Nullabilidade
 *
 * `ParsedRow.occurredOn` e `ParsedRow.amountCents` sao anulaveis (CONTRACTS §15).
 * Linha incompleta **nao pode ser gravada, mas tambem nao pode sumir**: ela
 * entra no preview com `null` no campo que faltou (`occurredOn`, `competence`,
 * `amountCents` e `dedupeHash` nulos), para o usuario completar na confirmacao —
 * ou excluir. Por isso os campos correspondentes do preview sao anulaveis.
 *
 * ## O que e gravado e a linha CONFIRMADA (RF-IMP-02/09)
 *
 * `finalizeImport` recalcula competencia e `dedupeHash` a partir dos valores
 * **editados**; nada do que o parser leu e gravado sem passar pela confirmacao.
 *
 * Modulo puro (CONVENTIONS §5): sem `lib/db`, `next/*`, `fs`, `fetch` nem
 * `process.env`. `today` e parametro; nenhuma leitura de relogio (CONVENTIONS
 * §4). Toda conta de calendario passa por `lib/date`.
 */

import {
  addCompetence,
  competenceStart,
  toCompetence,
  type Competence,
  type IsoDate,
} from '@/lib/date';
import { billingPeriodFor, type CardCycleConfig } from '@/lib/finance/billing';
import { matchRule, type Rule } from '@/lib/finance/categorization';
import { dedupeHash, normalizeDescription } from '@/lib/finance/dedupe';
import { detectInstallment } from '@/lib/import/installments';
import type { ParseDiagnostic, ParseResult } from '@/lib/import/types';
import { addCents, cents, type Cents } from '@/lib/money';

/** Tipo de origem: cartao de credito ou conta. */
export type SourceKind = 'credit_card' | 'account';

/** Parcela reconhecida e mantida depois do desempate com a data. */
export interface PreviewInstallment {
  current: number;
  total: number;
}

/**
 * Uma linha do preview. Os campos anulaveis espelham `ParsedRow`: `null` onde o
 * parser nao leu, e o usuario completa na confirmacao.
 */
export interface ImportPreviewRow {
  index: number;
  occurredOn: IsoDate | null;
  competence: Competence | null;
  description: string;
  rawDescription: string;
  amountCents: Cents | null;
  dedupeHash: string | null;
  suggestedCategoryId: string | null;
  suggestedMemberId: string | null;
  state: 'new' | 'duplicate' | 'installment_first' | 'installment_part';
  installment: PreviewInstallment | null;
}

/** Resumo do lote, exibido no rodape da tela de confirmacao. */
export interface ImportPreviewSummary {
  /** Total de linhas lidas pelo parser. */
  rowsRead: number;
  /**
   * Toda linha que **nao** e duplicata — inclui as parceladas
   * (`installment_first`/`installment_part`). Invariante:
   * `rowsNew + rowsDuplicated === rowsRead`.
   */
  rowsNew: number;
  /** Linhas cujo `dedupeHash` ja existia. */
  rowsDuplicated: number;
  /** Planos de parcela distintos entre as linhas nao duplicadas. Ortogonal aos baldes. */
  installmentPlansDetected: number;
  /** Soma dos valores das linhas **nao duplicadas** (o total que o rodape compara). */
  totalCents: Cents;
  /** Linhas nao duplicadas sem sugestao de categoria. */
  uncategorizedCount: number;
}

/** Entrada de `buildImportPreview`. */
export interface BuildImportPreviewInput {
  parse: ParseResult;
  sourceId: string;
  sourceKind: SourceKind;
  cardCycle: CardCycleConfig | null;
  rules: Rule[];
  existingHashes: Set<string>;
  today: IsoDate;
}

/** Saida de `buildImportPreview`. */
export interface ImportPreview {
  rows: ImportPreviewRow[];
  summary: ImportPreviewSummary;
  diagnostics: ParseDiagnostic[];
}

/** Competencia de uma data: fatura de cartao usa o ciclo; conta usa o mes. */
function competenceFor(
  occurredOn: IsoDate,
  sourceKind: SourceKind,
  cardCycle: CardCycleConfig | null,
): Competence {
  if (sourceKind === 'credit_card' && cardCycle !== null) {
    return billingPeriodFor(occurredOn, cardCycle).competence;
  }
  return toCompetence(occurredOn);
}

/** Dia e mes de uma data ja validada, sem aritmetica de calendario. */
function dayMonth(occurredOn: IsoDate): { day: number; month: number } {
  return {
    day: Number(occurredOn.slice(8, 10)),
    month: Number(occurredOn.slice(5, 7)),
  };
}

/**
 * Separa descricao e parcela, com o desempate contra a data da propria linha.
 * Ver o topo do arquivo.
 */
function resolveInstallment(
  rawDescription: string,
  occurredOn: IsoDate | null,
): { description: string; installment: PreviewInstallment | null } {
  const detected = detectInstallment(rawDescription);
  if (detected === null) return { description: rawDescription, installment: null };

  if (occurredOn !== null) {
    const { day, month } = dayMonth(occurredOn);
    // `03/10` numa linha de 03/10 e a propria data, nao a parcela 3 de 10.
    if (detected.current === day && detected.total === month) {
      return { description: rawDescription, installment: null };
    }
  }

  return {
    description: detected.cleanDescription,
    installment: { current: detected.current, total: detected.total },
  };
}

/** Chave de um plano no preview: descricao normalizada + total de parcelas. */
function planKey(description: string, total: number): string {
  return `${normalizeDescription(description)}|${String(total)}`;
}

/**
 * Monta o preview de uma importacao: competencia, hash de dedupe, sugestao de
 * categoria e deteccao de parcela (com desempate), sem gravar nada.
 *
 * Nao toca banco e nao le relogio: recebe `existingHashes` e `today` prontos.
 */
export function buildImportPreview(
  input: BuildImportPreviewInput,
): ImportPreview {
  const rows: ImportPreviewRow[] = input.parse.rows.map((row, index) => {
    const { description, installment } = resolveInstallment(
      row.rawDescription,
      row.occurredOn,
    );

    const occurredOn = row.occurredOn;
    const amountCents = row.amountCents;
    const competence =
      occurredOn === null
        ? null
        : competenceFor(occurredOn, input.sourceKind, input.cardCycle);

    const hash =
      occurredOn === null || amountCents === null
        ? null
        : dedupeHash({
            sourceId: input.sourceId,
            occurredOn,
            amountCents,
            rawDescription: row.rawDescription,
          });

    const duplicate = hash !== null && input.existingHashes.has(hash);
    const state: ImportPreviewRow['state'] = duplicate
      ? 'duplicate'
      : installment === null
        ? 'new'
        : installment.current === 1
          ? 'installment_first'
          : 'installment_part';

    const rule = matchRule(input.rules, description);

    return {
      index,
      occurredOn,
      competence,
      description,
      rawDescription: row.rawDescription,
      amountCents,
      dedupeHash: hash,
      suggestedCategoryId: rule === null ? null : rule.categoryId,
      suggestedMemberId: rule === null ? null : rule.memberId,
      state,
      installment,
    };
  });

  const notDuplicated = rows.filter((row) => row.state !== 'duplicate');

  const planKeys = new Set<string>();
  for (const row of notDuplicated) {
    if (row.installment !== null) {
      planKeys.add(planKey(row.description, row.installment.total));
    }
  }

  const amounts = notDuplicated
    .map((row) => row.amountCents)
    .filter((value): value is Cents => value !== null);

  return {
    rows,
    summary: {
      rowsRead: rows.length,
      // `rowsNew` = toda linha nao duplicada (inclui parceladas). Invariante do
      // CONTRACTS §15: `rowsNew + rowsDuplicated === rowsRead`, senao alguma
      // linha lida fica invisivel na aritmetica do resumo.
      rowsNew: notDuplicated.length,
      rowsDuplicated: rows.length - notDuplicated.length,
      installmentPlansDetected: planKeys.size,
      totalCents: addCents(...amounts),
      uncategorizedCount: notDuplicated.filter(
        (row) => row.suggestedCategoryId === null,
      ).length,
    },
    diagnostics: input.parse.diagnostics,
  };
}

// ---------------------------------------------------------------------------
// §16 — confirmacao e commit
// ---------------------------------------------------------------------------

/** Uma linha ja editada pelo usuario na tela de confirmacao. */
export interface ConfirmedRow {
  index: number;
  /** `false` = usuario excluiu a linha do lote. */
  include: boolean;
  occurredOn: IsoDate;
  description: string;
  /** Imutavel; vazio quando a origem e texto colado sem original. */
  rawDescription: string;
  amountCents: Cents;
  categoryId: string | null;
  memberId: string | null;
  installment: PreviewInstallment | null;
  /** Usuario decidiu incluir mesmo sendo duplicata. */
  forceDuplicate?: boolean;
}

/** Entrada de `finalizeImport`. */
export interface FinalizeInput {
  rows: ConfirmedRow[];
  sourceId: string;
  sourceKind: SourceKind;
  cardCycle: CardCycleConfig | null;
  existingHashes: Set<string>;
  reportedTotalCents: Cents | null;
}

/** Uma transacao pronta para gravar. */
export interface FinalizedTransaction {
  occurredOn: IsoDate;
  competence: Competence;
  cashDate: IsoDate | null;
  description: string;
  rawDescription: string;
  amountCents: Cents;
  categoryId: string | null;
  memberId: string | null;
  dedupeHash: string;
  installmentPlanRef: number | null;
  installmentNumber: number | null;
}

/** Um plano de parcelas detectado na fatura. */
export interface FinalizedInstallmentPlan {
  ref: number;
  description: string;
  totalCents: Cents;
  installmentsCount: number;
  firstCompetence: Competence;
  categoryId: string | null;
}

/** Resultado de `finalizeImport`. */
export interface FinalizeResult {
  transactions: FinalizedTransaction[];
  installmentPlans: FinalizedInstallmentPlan[];
  skipped: { index: number; reason: 'excluded_by_user' | 'duplicate' }[];
  totals: {
    includedCents: Cents;
    reportedCents: Cents | null;
    differenceCents: Cents | null;
    matches: boolean | null;
  };
}

/**
 * Data de saida do caixa (DATA-MODEL): em item de fatura e o vencimento da
 * fatura; em conta, e a propria data do fato.
 */
function cashDateFor(
  occurredOn: IsoDate,
  sourceKind: SourceKind,
  cardCycle: CardCycleConfig | null,
): IsoDate | null {
  if (sourceKind !== 'credit_card') return occurredOn;
  return cardCycle === null ? null : billingPeriodFor(occurredOn, cardCycle).dueDate;
}

/** Descricao de uma parcela gerada: "Mercado Livre (4/10)". */
function childDescription(
  description: string,
  number: number,
  count: number,
): string {
  return `${description} (${String(number)}/${String(count)})`;
}

/**
 * Converte as linhas confirmadas no que sera gravado.
 *
 * - recalcula competencia e `dedupeHash` a partir dos valores EDITADOS
 * - agrupa linhas parceladas em planos e projeta as parcelas FUTURAS como
 *   transacoes filhas (`occurredOn` = inicio da competencia da parcela, uma
 *   projecao: a data real de uma parcela futura nao existe no arquivo)
 * - devolve o que foi ignorado e por que
 *
 * `includedCents` soma apenas as linhas **confirmadas** (o lote da fatura), nao
 * as parcelas futuras projetadas, que pertencem a faturas seguintes.
 */
export function finalizeImport(input: FinalizeInput): FinalizeResult {
  const transactions: FinalizedTransaction[] = [];
  const installmentPlans: FinalizedInstallmentPlan[] = [];
  const skipped: FinalizeResult['skipped'] = [];
  const included: Cents[] = [];

  // Dedupe tambem dentro do lote: duas linhas confirmadas com o mesmo hash e
  // sem `forceDuplicate` nao entram as duas.
  const seen = new Set(input.existingHashes);
  const plansByKey = new Map<string, FinalizedInstallmentPlan>();

  for (const row of input.rows) {
    if (!row.include) {
      skipped.push({ index: row.index, reason: 'excluded_by_user' });
      continue;
    }

    const hash = dedupeHash({
      sourceId: input.sourceId,
      occurredOn: row.occurredOn,
      amountCents: row.amountCents,
      rawDescription: row.rawDescription,
    });
    if (seen.has(hash) && row.forceDuplicate !== true) {
      skipped.push({ index: row.index, reason: 'duplicate' });
      continue;
    }
    seen.add(hash);

    const competence = competenceFor(
      row.occurredOn,
      input.sourceKind,
      input.cardCycle,
    );

    let planRef: number | null = null;
    let installmentNumber: number | null = null;

    if (row.installment !== null) {
      const key = planKey(row.description, row.installment.total);
      let plan = plansByKey.get(key);
      if (plan === undefined) {
        plan = {
          ref: installmentPlans.length + 1,
          description: row.description,
          // `amountCents * total`: `allocate` divide isso em N partes iguais ao
          // valor confirmado, entao o plano e as parcelas fecham com a linha.
          totalCents: cents(row.amountCents * row.installment.total),
          installmentsCount: row.installment.total,
          firstCompetence: addCompetence(
            competence,
            -(row.installment.current - 1),
          ),
          categoryId: row.categoryId,
        };
        installmentPlans.push(plan);
        plansByKey.set(key, plan);

        for (
          let number = row.installment.current + 1;
          number <= row.installment.total;
          number += 1
        ) {
          const childCompetence = addCompetence(plan.firstCompetence, number - 1);
          const childOccurredOn = competenceStart(childCompetence);
          const childText = childDescription(
            plan.description,
            number,
            plan.installmentsCount,
          );
          transactions.push({
            occurredOn: childOccurredOn,
            competence: childCompetence,
            cashDate: cashDateFor(
              childOccurredOn,
              input.sourceKind,
              input.cardCycle,
            ),
            description: childText,
            rawDescription: '',
            amountCents: row.amountCents,
            categoryId: row.categoryId,
            memberId: row.memberId,
            dedupeHash: dedupeHash({
              sourceId: input.sourceId,
              occurredOn: childOccurredOn,
              amountCents: row.amountCents,
              rawDescription: childText,
            }),
            installmentPlanRef: plan.ref,
            installmentNumber: number,
          });
        }
      }
      planRef = plan.ref;
      installmentNumber = row.installment.current;
    }

    transactions.push({
      occurredOn: row.occurredOn,
      competence,
      cashDate: cashDateFor(row.occurredOn, input.sourceKind, input.cardCycle),
      description: row.description,
      rawDescription: row.rawDescription,
      amountCents: row.amountCents,
      categoryId: row.categoryId,
      memberId: row.memberId,
      dedupeHash: hash,
      installmentPlanRef: planRef,
      installmentNumber,
    });
    included.push(row.amountCents);
  }

  const includedCents = addCents(...included);
  const reportedCents = input.reportedTotalCents;
  const differenceCents =
    reportedCents === null ? null : addCents(includedCents, cents(-reportedCents));

  return {
    transactions,
    installmentPlans,
    skipped,
    totals: {
      includedCents,
      reportedCents,
      differenceCents,
      matches: differenceCents === null ? null : differenceCents === 0,
    },
  };
}
