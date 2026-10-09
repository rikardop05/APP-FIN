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
import { matchRuleForKind, type Rule } from '@/lib/finance/categorization';
import { dedupeHash, normalizeDescription } from '@/lib/finance/dedupe';
import { detectInstallment } from '@/lib/import/installments';
import type {
  DocumentDate,
  ParsedRow,
  ParseDiagnostic,
  ParseResult,
} from '@/lib/import/types';
import { addCents, cents, type Cents } from '@/lib/money';

/**
 * Primeira regra que casa a descricao **e cuja categoria cabe no sinal da
 * linha** (`ruleFitsKind`, no motor): saida nao recebe categoria de receita, entrada
 * so recebe categoria de receita. A regra incompativel e pulada e a proxima por
 * prioridade ainda pode casar.
 *
 * Usada pela sugestao do preview e pelo rastro `category_rule_id` do commit,
 * para os dois escolherem a MESMA regra. Sem conferencia quando o sinal nao e
 * conhecido (valor nao lido, ou zero, que nao vira lancamento) ou quando a
 * regra nao traz `categoryNature`.
 */
export function matchRuleForAmount(
  rules: Rule[],
  description: string,
  amountCents: Cents | null,
): Rule | null {
  const kind =
    amountCents === null || amountCents === 0
      ? null
      : amountCents < 0
        ? 'expense'
        : 'income';
  // A regra de pular a incompativel mora no motor (`ruleFitsKind`); aqui so o
  // sinal da linha vira tipo.
  return matchRuleForKind(rules, description, kind);
}

/**
 * Qual regra deu a categoria de cada linha gravada (`category_rule_id`, F3).
 *
 * A linha confirmada so diz a categoria, nao de onde ela veio. Ela veio da
 * regra quando a regra vencedora — a mesma do preview, `matchRuleForAmount`,
 * que pula regra de natureza incompativel com o sinal — aponta para EXATAMENTE
 * a categoria confirmada. Categoria trocada na tela, ou deixada vazia, e
 * decisao do usuario, e fica sem rastro.
 */
export function attributeRules(
  rules: Rule[],
  rows: readonly {
    description: string;
    amountCents: Cents;
    categoryId: string | null;
  }[],
): (string | null)[] {
  return rows.map((row) => {
    if (row.categoryId === null) return null;
    const rule = matchRuleForAmount(rules, row.description, row.amountCents);
    return rule !== null && rule.categoryId === row.categoryId ? rule.id : null;
  });
}

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
  state:
    | 'new'
    | 'duplicate'
    | 'installment_first'
    | 'installment_part'
    | 'credit_card_payment'
    /**
     * Valor zero lido (decisao 8, ex.: anuidade de R$ 0,00): nao e despesa nem receita.
     * Chega desmarcada, com o rotulo "Informativa"; so entra se o usuario corrigir o valor.
     */
    | 'informational';
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
  /**
   * Competencia da **FATURA** importada (a escolhida na tela), ou `null`.
   *
   * Numa fatura de cartao a competencia e **declarada, nao inferida**: tudo que
   * esta impresso naquela fatura e cobrado naquele ciclo. Por isso, quando
   * `sourceKind === 'credit_card'` e este campo vem preenchido, **toda linha
   * recebe esta competencia** — inclusive parcelas antigas, cuja data de compra
   * e de meses antes (a parcela 11/12 cai na fatura corrente, nao na fatura da
   * compra). `null` = sem escolha (texto colado): a competencia volta a ser
   * derivada de `occurredOn`. Na conta (`'account'`) o campo e ignorado.
   *
   * Nome escolhido de proposito: nao e o `defaultCompetence` do parser, que
   * serve so para dar o ANO de uma data sem ano; confundir os dois e facil.
   */
  statementCompetence: Competence | null;
  /**
   * Final do cartao -> `memberId`, ja filtrado para o cartao importado (decisao
   * 20, opcional). Linha com `ParsedRow.cardLast4` mapeado sai com
   * `suggestedMemberId` do dono do final; o usuario pode trocar na confirmacao.
   *
   * Regra com `memberId` explicito VENCE o cartao: ela e a escolha mais
   * especifica (a escola do filho paga no cartao do pai e do filho). Regra sem
   * membro deixa o cartao preencher. Ausente = comportamento anterior.
   */
  cardHolders?: ReadonlyMap<string, string>;
  /**
   * Planos de parcelamento ja gravados para o cartao do lote (ver
   * `ExistingInstallmentPlan`). A linha que casa com um deles nao conta como
   * plano novo em `installmentPlansDetected`. Ausente = `[]`.
   */
  existingPlans?: readonly ExistingInstallmentPlan[];
}

/**
 * Um plano de parcelamento JA GRAVADO, do household e do cartao do lote.
 * Contrato combinado com a Estaca (`listExistingInstallmentPlans` em lib/db).
 *
 * Existe para a fatura SEGUINTE de um parcelamento nao criar outro plano nem
 * reprojetar as parcelas que o lote anterior ja projetou: com o mesmo
 * `dedupe_hash`, isso violava o indice unico (household_id, dedupe_hash) no
 * commit, e o mes contava em dobro.
 */
export interface ExistingInstallmentPlan {
  /** `installment_plans.id`. */
  id: string;
  /** Descricao CONFIRMADA no lote que criou o plano (pode ter sido editada). */
  description: string;
  installmentsCount: number;
  totalCents: Cents;
  firstCompetence: Competence;
  /** Parcelas `planned` do plano: a que tem o numero da linha real e conciliada. */
  openPlanned: { installmentNumber: number; transactionId: string }[];
  /** Numeros com transacao `posted`: ja tem a parcela real, nao casam de novo. */
  postedNumbers: number[];
  /**
   * `raw_description` das transacoes reais (posted) do plano. Casa o plano
   * quando o usuario trocou a descricao no primeiro lote ("Sofa da sala").
   */
  rawDescriptions?: string[];
}

/** O que `findExistingPlan` precisa saber de uma linha parcelada. */
interface InstallmentLineKey {
  description: string;
  rawDescription: string;
  amountCents: Cents;
  installment: PreviewInstallment;
  /** Competencia em que a linha e cobrada (a da fatura, em cartao). */
  competence: Competence;
}

/**
 * Plano gravado a que a linha parcelada pertence, ou `null`.
 *
 * Casa quando, ao mesmo tempo:
 * - a descricao bate: `planKey` da descricao confirmada da linha com a do plano,
 *   OU a descricao normalizada da `rawDescription` da linha com a de alguma real
 *   do plano (`rawDescriptions`) — `normalizeDescription` tira o sufixo de
 *   parcela, entao `03/10` e `04/10` casam;
 * - o total de parcelas e o mesmo;
 * - a primeira competencia e a mesma: `competencia - (current - 1)`. E o que
 *   separa a compra de outra identica iniciada em outro mes;
 * - o valor fecha com o total do plano com ate 1 centavo por parcela
 *   (`|amount * total - totalCents| <= total`): o banco arredonda a primeira ou
 *   a ultima parcela (100,00 em 3x = 33,33/33,33/33,34);
 * - o numero da linha ainda nao tem parcela real (`postedNumbers`, mais os
 *   numeros ja tomados neste lote). Se tiver, tenta o proximo candidato: duas
 *   compras identicas no mesmo mes sao dois planos com a mesma chave.
 *
 * Ordem dos candidatos: a do array (o loader entrega por created_at, id).
 */
function findExistingPlan(
  plans: readonly ExistingInstallmentPlan[],
  line: InstallmentLineKey,
  takenNumbers: ReadonlyMap<string, ReadonlySet<number>>,
): ExistingInstallmentPlan | null {
  const { current, total } = line.installment;
  const firstCompetence = addCompetence(line.competence, -(current - 1));
  const lineKey = planKey(line.description, total);
  const rawKey = normalizeDescription(line.rawDescription);
  for (const plan of plans) {
    if (plan.installmentsCount !== total || plan.firstCompetence !== firstCompetence) continue;
    const describes =
      planKey(plan.description, plan.installmentsCount) === lineKey ||
      (rawKey !== '' &&
        (plan.rawDescriptions ?? []).some((raw) => normalizeDescription(raw) === rawKey));
    if (!describes) continue;
    const deviation = line.amountCents * total - plan.totalCents;
    if (Math.abs(deviation) > total) continue;
    if (plan.postedNumbers.includes(current) || takenNumbers.get(plan.id)?.has(current) === true) {
      continue;
    }
    return plan;
  }
  return null;
}

/** Saida de `buildImportPreview`. */
export interface ImportPreview {
  rows: ImportPreviewRow[];
  summary: ImportPreviewSummary;
  diagnostics: ParseDiagnostic[];
  /**
   * Data de referencia impressa no documento, com o `kind` — o pipeline so
   * CARREGA o que o parser expos. A comparacao com a competencia declarada e a
   * frase sao da tela (avisa, nao bloqueia); aqui nada e recalculado a partir
   * dela. `null` quando a origem nao traz data (texto colado).
   */
  documentDate: DocumentDate | null;
  /**
   * Total **impresso** no documento (`ParseResult.reportedTotalCents`), so
   * CARREGADO ate a tela e devolvido no commit, que o grava em
   * `statements.reported_total_cents` para a conferencia com a soma das linhas.
   * `null` quando a origem nao imprime total (texto colado).
   */
  reportedTotalCents: Cents | null;
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

/**
 * Competencia DECLARADA da fatura, quando a origem e cartao. `null` para conta ou
 * quando a fatura nao trouxe competencia — nesse caso `competenceFor` decide.
 */
function declaredCardCompetence(
  sourceKind: SourceKind,
  statementCompetence: Competence | null,
): Competence | null {
  return sourceKind === 'credit_card' ? statementCompetence : null;
}

/**
 * Competencia de uma linha de cartao, resolvida.
 *
 * A fatura vence a data: se a origem e cartao e a competencia da fatura foi
 * informada, e ela. Fora disso, deriva de `occurredOn` (conta; ou fatura sem
 * competencia informada, como texto colado).
 */
function resolveCompetence(
  occurredOn: IsoDate,
  sourceKind: SourceKind,
  cardCycle: CardCycleConfig | null,
  statementCompetence: Competence | null,
): Competence {
  return (
    declaredCardCompetence(sourceKind, statementCompetence) ??
    competenceFor(occurredOn, sourceKind, cardCycle)
  );
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
 *
 * A PARCELA pode ter vindo de uma **coluna propria** — Santander `x=168`,
 * Mercado Pago `x≈395` — e nesse caso o parser ja a isolou em
 * `ParsedRow.installment`; ela manda sobre o que a descricao sugere. A limpeza do
 * sufixo da descricao continua vindo do detector, porque o Nubank embute a
 * parcela no proprio texto.
 */
function resolveInstallment(row: ParsedRow): {
  description: string;
  installment: PreviewInstallment | null;
} {
  const { rawDescription, occurredOn } = row;
  const fromDescription = detectInstallment(rawDescription);
  const description =
    fromDescription === null ? rawDescription : fromDescription.cleanDescription;

  const detected = row.installment ?? fromDescription;
  if (detected === null) return { description, installment: null };

  if (occurredOn !== null) {
    const { day, month } = dayMonth(occurredOn);
    // `03/10` numa linha de 03/10 e a propria data, nao a parcela 3 de 10.
    if (detected.current === day && detected.total === month) {
      return { description: rawDescription, installment: null };
    }
  }

  return {
    description,
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
 * Competencia: numa fatura de cartao com `statementCompetence` informada, **toda
 * linha recebe a competencia da fatura** — nao a derivada da data da compra (uma
 * parcela 11/12 cai na fatura corrente, nao na fatura de 11 meses atras). Sem
 * competencia (texto colado) ou em conta, deriva de `occurredOn`.
 *
 * Nao toca banco e nao le relogio: recebe `existingHashes` e `today` prontos.
 */
export function buildImportPreview(
  input: BuildImportPreviewInput,
): ImportPreview {
  const rows: ImportPreviewRow[] = input.parse.rows.map((row, index) => {
    const { description, installment } = resolveInstallment(row);
    // Linha informativa (decisao 8, R$ 0,00): zero nao e compromisso, entao a
    // parcela impressa ao lado (`ANUIDADE DIFERENCIADA 01/12`) nao conta como
    // plano nem vira estado de parcela. A parcela LIDA fica na linha: se o
    // usuario corrigir o valor, o plano nao se perde. Quem barra o zero, com a
    // parcela junto, e o `finalizeImport`.
    const informational = row.informational === true;

    const occurredOn = row.occurredOn;
    const amountCents = row.amountCents;
    // A competencia da fatura e DECLARADA: se veio, toda linha pertence a ela,
    // mesmo sem data de compra. Sem ela, deriva de `occurredOn` como antes.
    const declared = declaredCardCompetence(
      input.sourceKind,
      input.statementCompetence,
    );
    const competence =
      declared ??
      (occurredOn === null
        ? null
        : competenceFor(occurredOn, input.sourceKind, input.cardCycle));

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
    // Pagamento da fatura anterior (RF-CC-04): chega a confirmacao marcado para a
    // tela desmarcar por default, porque num CARTAO ele e um `credit_card_payment`
    // que pertence a conta, e importa-lo pelo cartao conta duas vezes.
    //
    // O gate em `sourceKind` NAO e detalhe: numa CONTA, a mesma linha e um
    // lancamento LEGITIMO — e exatamente onde a RF-CC-04 manda registra-la.
    // Sem o gate, escolher a origem "conta" marcaria a linha para exclusao do
    // unico lugar a que ela pertence (o erro invertido). A decisao e do pipeline
    // e nao do parser: o parser so REPORTA o que ve (`creditCardPayment` e uma
    // observacao de texto, verdadeira independente da origem); o que fazer com
    // ela depende da origem, que so o pipeline conhece.
    const isCreditCardPayment =
      input.sourceKind === 'credit_card' && row.creditCardPayment === true;
    const state: ImportPreviewRow['state'] = duplicate
      ? 'duplicate'
      : isCreditCardPayment
        ? 'credit_card_payment'
        : informational
          ? 'informational'
          : installment === null
            ? 'new'
            : installment.current === 1
              ? 'installment_first'
              : 'installment_part';

    const rule = matchRuleForAmount(input.rules, description, amountCents);
    // Decisao 20: o dono do final do cartao, se mapeado. A regra com membro vence.
    // So em cartao, como o `creditCardPayment`: numa conta o final nao tem dono.
    const cardHolder =
      input.sourceKind !== 'credit_card' || row.cardLast4 === undefined
        ? null
        : (input.cardHolders?.get(row.cardLast4) ?? null);

    return {
      index,
      occurredOn,
      competence,
      description,
      rawDescription: row.rawDescription,
      amountCents,
      dedupeHash: hash,
      suggestedCategoryId: rule === null ? null : rule.categoryId,
      suggestedMemberId: rule?.memberId ?? cardHolder,
      state,
      installment,
    };
  });

  const notDuplicated = rows.filter((row) => row.state !== 'duplicate');

  const isInformational = (row: ImportPreviewRow): boolean =>
    input.parse.rows[row.index]?.informational === true;

  // Linha de um plano JA GRAVADO (fatura seguinte) nao e plano novo.
  const existingPlans = input.existingPlans ?? [];
  const takenNumbers = new Map<string, Set<number>>();
  const planKeys = new Set<string>();
  for (const row of notDuplicated) {
    if (row.installment === null || isInformational(row)) continue;
    if (row.amountCents !== null && row.competence !== null) {
      const existing = findExistingPlan(
        existingPlans,
        {
          description: row.description,
          rawDescription: row.rawDescription,
          amountCents: row.amountCents,
          installment: row.installment,
          competence: row.competence,
        },
        takenNumbers,
      );
      if (existing !== null) {
        const taken = takenNumbers.get(existing.id) ?? new Set<number>();
        taken.add(row.installment.current);
        takenNumbers.set(existing.id, taken);
        continue;
      }
    }
    planKeys.add(planKey(row.description, row.installment.total));
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
      // Linha informativa nao vira lancamento: nao ha o que categorizar.
      uncategorizedCount: notDuplicated.filter(
        (row) => row.suggestedCategoryId === null && !isInformational(row),
      ).length,
    },
    diagnostics: input.parse.diagnostics,
    documentDate: input.parse.documentDate ?? null,
    reportedTotalCents: input.parse.reportedTotalCents,
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
  /**
   * Competencia da **FATURA** (mesma regra de `BuildImportPreviewInput`). Quando
   * preenchida e a origem e cartao, toda linha confirmada recebe esta competencia
   * e as parcelas futuras sao projetadas a partir dela. `null` = deriva de
   * `occurredOn` (comportamento anterior).
   */
  statementCompetence: Competence | null;
  /**
   * Planos ja gravados do household para o cartao do lote. A linha que casa
   * (`findExistingPlan`) liga ao plano existente, concilia a planned do mesmo
   * numero e NAO cria plano nem projeta parcelas. Ausente = `[]`.
   */
  existingPlans?: readonly ExistingInstallmentPlan[];
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
  /** Plano NOVO deste lote (`installmentPlans[].ref`). Exclusivo com `installmentPlanId`. */
  installmentPlanRef: number | null;
  /** Plano JA GRAVADO (`ExistingInstallmentPlan.id`), com `installmentPlanRef` null. */
  installmentPlanId: string | null;
  installmentNumber: number | null;
  /**
   * A `planned` do plano existente que esta linha real cumpre (mesmo numero):
   * o commit a grava `reconciled` com `reconciled_by` = esta linha. `null`
   * quando nao ha planned aberta daquele numero.
   */
  reconcilesTransactionId: string | null;
}

/** Um plano de parcelas detectado na fatura. */
export interface FinalizedInstallmentPlan {
  ref: number;
  /**
   * `index` da linha confirmada que abriu o plano: a "linha de origem" que a
   * coluna "Ainda presos" mostra (`summarizeStillHeld`). Aditivo; o banco nao o
   * grava.
   */
  sourceIndex: number;
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
  /**
   * `informational` (decisao 8): valor CONFIRMADO zero. Nao e despesa nem
   * receita, entao nao vira lancamento nem plano — com ou sem parcela.
   */
  skipped: {
    index: number;
    reason: 'excluded_by_user' | 'duplicate' | 'informational';
  }[];
  totals: {
    includedCents: Cents;
    reportedCents: Cents | null;
    differenceCents: Cents | null;
    matches: boolean | null;
  };
}

/**
 * Data de saida do caixa (DATA-MODEL): em item de fatura e o vencimento **da
 * fatura em que a linha e cobrada** (a competencia), nao o vencimento da fatura
 * em que a data da compra cairia — uma parcela antiga e cobrada na fatura
 * corrente, nao na do mes da compra. Em conta, e a propria data do fato.
 */
function cashDateFor(
  occurredOn: IsoDate,
  competence: Competence,
  sourceKind: SourceKind,
  cardCycle: CardCycleConfig | null,
): IsoDate | null {
  if (sourceKind !== 'credit_card') return occurredOn;
  if (cardCycle === null) return null;
  // `competenceStart` cai sempre na propria competencia (o 1o dia e <= o
  // fechamento), entao `billingPeriodFor` devolve o vencimento dela.
  return billingPeriodFor(competenceStart(competence), cardCycle).dueDate;
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
  const existingPlans = input.existingPlans ?? [];
  // Numeros de parcela ja tomados neste lote, por plano existente.
  const takenNumbers = new Map<string, Set<number>>();

  for (const row of input.rows) {
    if (!row.include) {
      skipped.push({ index: row.index, reason: 'excluded_by_user' });
      continue;
    }
    // Pelo valor CONFIRMADO, nao pela marca do parser (regra 7): zero editado
    // para um valor entra; um valor editado para zero sai. Daqui para frente
    // nenhuma transacao tem valor zero, e o `kind` por sinal nunca ve zero.
    if (row.amountCents === 0) {
      skipped.push({ index: row.index, reason: 'informational' });
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

    const competence = resolveCompetence(
      row.occurredOn,
      input.sourceKind,
      input.cardCycle,
      input.statementCompetence,
    );

    let planRef: number | null = null;
    let existingPlanId: string | null = null;
    let reconcilesTransactionId: string | null = null;
    let installmentNumber: number | null = null;

    if (row.installment !== null) {
      // Fatura seguinte de um plano ja gravado: liga a ele, concilia a planned do
      // mesmo numero e nao cria plano nem reprojeta (as futuras ja existem).
      // So a linha que CASA de fato (`findExistingPlan`) vai para o plano: uma
      // compra nova com a mesma descricao cai no `plansByKey` (plano novo), na
      // ordem que for — a mesma regra do preview. Como o numero tomado bloqueia
      // o plano, duas linhas nunca conciliam a mesma planned.
      const existing = findExistingPlan(
        existingPlans,
        {
          description: row.description,
          rawDescription: row.rawDescription,
          amountCents: row.amountCents,
          installment: row.installment,
          competence,
        },
        takenNumbers,
      );
      if (existing !== null) {
        const current = row.installment.current;
        reconcilesTransactionId =
          existing.openPlanned.find((planned) => planned.installmentNumber === current)
            ?.transactionId ?? null;
        const taken = takenNumbers.get(existing.id) ?? new Set<number>();
        taken.add(current);
        takenNumbers.set(existing.id, taken);
        existingPlanId = existing.id;
        installmentNumber = current;
      }
    }

    if (row.installment !== null && existingPlanId === null) {
      const key = planKey(row.description, row.installment.total);
      let plan = plansByKey.get(key);
      if (plan === undefined) {
        plan = {
          ref: installmentPlans.length + 1,
          sourceIndex: row.index,
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
              childCompetence,
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
            installmentPlanId: null,
            installmentNumber: number,
            reconcilesTransactionId: null,
          });
        }
      }
      planRef = plan.ref;
      installmentNumber = row.installment.current;
    }

    transactions.push({
      occurredOn: row.occurredOn,
      competence,
      cashDate: cashDateFor(
        row.occurredOn,
        competence,
        input.sourceKind,
        input.cardCycle,
      ),
      description: row.description,
      rawDescription: row.rawDescription,
      amountCents: row.amountCents,
      categoryId: row.categoryId,
      memberId: row.memberId,
      dedupeHash: hash,
      installmentPlanRef: planRef,
      installmentPlanId: existingPlanId,
      installmentNumber,
      reconcilesTransactionId,
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
