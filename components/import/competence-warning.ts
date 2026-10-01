import { addCompetence, type Competence, type IsoDate } from '@/lib/date';
import { statementWindow } from '@/lib/finance/billing';

import type { SourceKind, UploadResponse, CardFull } from './schemas';

/**
 * A diferença entre o vencimento esperado e o impresso tem causas diferentes, e
 * cada uma pede uma frase própria — a mesma comparação, três mensagens:
 *
 *  - `competence`   o vencimento impresso É o de OUTRA competência do mesmo cartão
 *                   (Mercado Pago de julho declarado como 09/2026). Quem errou foi
 *                   a competência declarada.
 *  - `registration` o vencimento impresso cai no MESMO mês do esperado, em outro
 *                   dia (Santander vence dia 7, cartão cadastrado para o dia 10).
 *                   A competência está certa; o CADASTRO do cartão está errado, e
 *                   um ciclo errado desloca a competência de toda importação futura
 *                   daquele cartão, em silêncio.
 *  - `unclear`      não bate com nenhuma competência próxima e também não é o mesmo
 *                   mês: tanto a competência quanto o cadastro podem estar errados.
 *                   Não escolhemos um culpado que não sabemos.
 */
export type CompetenceMismatch = {
  kind: 'competence' | 'registration' | 'unclear';
  /** O que o documento imprime (vencimento). */
  printedDueDate: IsoDate;
  /** A competência que o usuário declarou. */
  declaredCompetence: Competence;
  /** O vencimento que o sistema esperava para essa competência, pelo ciclo cadastrado. */
  expectedDueDate: IsoDate;
  /** Dia de vencimento cadastrado no cartão. */
  registeredDueDay: number;
  /**
   * Só em `registration`, e só quando a evidência SUSTENTA a correção: o dia de
   * vencimento a oferecer. É o dia impresso, e só é oferecido se, com ele no lugar
   * do cadastrado (e o `closingDay` intocado — o documento não o diz e não se
   * inventa), o vencimento esperado da competência declarada passaria a ser
   * exatamente o impresso. Se não passa (ex.: o dia impresso fica antes do
   * fechamento e empurraria o vencimento para o mês seguinte), o fechamento
   * provavelmente também está errado, e oferecer "corrigir" um número que não
   * resolve seria pior que não oferecer: `null`, e a tela só manda conferir.
   */
  fix: { dueDay: number } | null;
};

type PreviewDocumentDate = UploadResponse['preview']['documentDate'];

/** Quantas competências para cada lado procurar o vencimento impresso. */
const SEARCH_RADIUS_MONTHS = 12;

/**
 * A competência declarada bate com o que o documento imprime? (avisa, NÃO bloqueia.)
 *
 * Compara DATAS, nunca meses de competência: `esperado = statementWindow(declarada,
 * ciclo).dueDate`, e há divergência quando `esperado !== documentDate.date`.
 * Comparar o mês da competência com o mês do vencimento gritaria em toda
 * importação correta de um cartão cujo vencimento cai no mês seguinte ao
 * fechamento (fechamento 25, vencimento 5: a fatura de competência 09 vence em
 * OUTUBRO), e quem recebe aviso falso para de ler.
 *
 * Divergindo, classifica a causa (ver `CompetenceMismatch`): se o vencimento
 * impresso é exatamente o esperado de outra competência até ±12 meses, o erro é da
 * competência; se cai no mesmo mês do esperado, é do cadastro. Procurar a
 * competência (em vez de só comparar meses) evita acusar a competência quando um
 * cadastro com dia errado cruzaria o mês.
 *
 * `closingDay` NÃO é conferido: nenhum parser expõe a data de fechamento, e o
 * dia de fechamento não se infere com segurança das linhas (compras antigas e
 * parcelas legitimamente caem fora da janela).
 *
 * Devolve `null` (nada a mostrar, e NENHUM aviso de "não consegui ler") quando:
 *  - a origem não é cartão, ou não há ciclo: não existe vencimento esperado;
 *  - o documento não imprimiu data (`documentDate` nulo: texto colado, PDF sem
 *    cabeçalho reconhecido): não há o que comparar;
 *  - a data não é um vencimento (`statement_date`): não é comparável com o
 *    vencimento esperado, e compará-la daria falso alarme em importação certa.
 */
export function competenceMismatch(input: {
  sourceKind: SourceKind;
  cardCycle: UploadResponse['cardCycle'];
  declaredCompetence: Competence;
  documentDate: PreviewDocumentDate;
}): CompetenceMismatch | null {
  const { sourceKind, cardCycle, declaredCompetence, documentDate } = input;
  if (sourceKind !== 'credit_card' || cardCycle === null) return null;
  if (documentDate === null || documentDate.kind !== 'due_date') return null;

  const printedDueDate = documentDate.date;
  const expectedDueDate = statementWindow(declaredCompetence, cardCycle).dueDate;
  if (expectedDueDate === printedDueDate) return null;

  const base = {
    printedDueDate,
    declaredCompetence,
    expectedDueDate,
    registeredDueDay: cardCycle.dueDay,
    fix: null,
  };

  for (let offset = -SEARCH_RADIUS_MONTHS; offset <= SEARCH_RADIUS_MONTHS; offset += 1) {
    if (offset === 0) continue;
    const candidate = addCompetence(declaredCompetence, offset);
    if (statementWindow(candidate, cardCycle).dueDate === printedDueDate) {
      return { kind: 'competence', ...base };
    }
  }

  // Mesmo mês do vencimento esperado, outro dia: a competência está certa.
  if (printedDueDate.slice(0, 7) === expectedDueDate.slice(0, 7)) {
    const printedDay = Number(printedDueDate.slice(8, 10));
    const candidate = { closingDay: cardCycle.closingDay, dueDay: printedDay };
    const sustained =
      printedDay !== cardCycle.dueDay &&
      statementWindow(declaredCompetence, candidate).dueDate === printedDueDate;
    return { kind: 'registration', ...base, fix: sustained ? { dueDay: printedDay } : null };
  }

  return { kind: 'unclear', ...base };
}

/**
 * Corpo do `PATCH /api/cards/[id]` para trocar SÓ o dia de vencimento.
 *
 * A rota SUBSTITUI o cartão inteiro (`cardBodySchema`): campo opcional omitido
 * (`bank`, `holderMemberId`, `paymentAccountId`) é gravado como `null`. Por isso o
 * corpo carrega todo campo do cartão como está, lido na hora, e só `dueDay` muda.
 * `closingDay` é copiado, nunca alterado: o documento não o diz.
 */
export function cardPatchBody(card: CardFull, dueDay: number) {
  return {
    name: card.name,
    bank: card.bank,
    brand: card.brand,
    holderMemberId: card.holderMemberId,
    paymentAccountId: card.paymentAccountId,
    creditLimitCents: card.creditLimitCents,
    closingDay: card.closingDay,
    dueDay,
  };
}
