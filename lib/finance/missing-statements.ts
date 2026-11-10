/**
 * Fatura do mes ainda nao importada — pendencia do Painel (Lote 1, item 3).
 *
 * Modulo puro (CONVENTIONS §5): recebe `today`, nao le relogio; a janela da fatura
 * vem de `statementWindow` (lib/finance/billing.ts), que e quem sabe quando a fatura
 * de uma competencia fecha e vence.
 *
 * ## A regra
 *
 * Olham-se DUAS competencias: a corrente (`toCompetence(today)`) e a anterior. Para
 * cada uma, um cartao ATIVO tem fatura pendente de importacao quando:
 *
 * 1. a fatura daquela competencia JA FECHOU: `closingDate < today`. No proprio dia
 *    do fechamento ainda nao: a fatura cobre as compras ate o fim desse dia
 *    (`statementWindow.to` e inclusivo), entao o arquivo do banco so existe a partir
 *    do dia seguinte;
 * 2. nao existe `statement` desse cartao nessa competencia;
 * 3. SO PARA A ANTERIOR: o cartao ja tem alguma fatura de competencia MENOR que ela.
 *    Ou seja, a anterior so e cobrada quando e um BURACO no meio do historico, nunca
 *    o comeco dele.
 *
 * A corrente conta sempre (condicoes 1 e 2). Cada janela pendente e uma pendencia
 * PROPRIA (um cartao pode ter duas).
 *
 * Por que a anterior entra (decisao do Orquestrador, 2026-11-10, achado da Lupa): so
 * com a corrente, a pendencia sumia na virada do mes sem ninguem ter importado. Um
 * cartao que fecha 25 e vence 28 so tinha a fatura de novembro pendente de 26 a
 * 30/11; em 01/12 o Painel voltava a dizer "Nada pendente". A fatura da competencia
 * anterior esta sempre fechada (fecha, no maximo, no fim do mes dela).
 *
 * Por que a condicao 3 (decisao do Orquestrador, 2026-11-10, conferida no dado real):
 * sem ela, a casa cujo historico comeca em novembro via "Fatura de outubro ainda nao
 * importada" nos 5 cartoes — pendencia falsa, ninguem vai importar o que veio antes
 * do comeco. O mesmo vale para o cartao recem-cadastrado: sem fatura anterior a
 * cobrada, nao ha buraco. Isso dispensa `created_at` em `credit_cards`.
 *
 * CUSTO ACEITO: se a PRIMEIRA fatura esperada de um cartao nunca for importada, ela
 * e pendencia enquanto for a corrente e some na virada do mes (nao ha historico antes
 * dela para caracterizar buraco).
 *
 * So UMA competencia para tras, de proposito: sem limite, um buraco antigo geraria
 * pendencia para sempre.
 *
 * A competencia e o mes do VENCIMENTO (decisao de 2026-11-09). Por isso um cartao
 * que fecha dia 30 e vence dia 7 tem a fatura de novembro fechada em 30/10: ela e
 * pendencia desde 01/11. Um cartao que fecha dia 10 e vence dia 20 so vira
 * pendencia em 11/11.
 *
 * Cartao sem nenhuma fatura na vida (recem-cadastrado) conta so na corrente, se ja
 * fechou. Cartao inativo e filtrado por quem chama.
 */

import { addCompetence, toCompetence, type Competence, type IsoDate } from '@/lib/date';

import { statementWindow, type CardCycleConfig } from './billing';

export interface MissingStatement {
  creditCardId: string;
  /** A competencia da fatura que falta: a corrente ou a anterior. */
  competence: Competence;
  closingDate: IsoDate;
  dueDate: IsoDate;
}

/**
 * Faturas ja fechadas e nao importadas: a da competencia de `today` e, quando e um
 * buraco no historico do cartao, a da anterior. Uma entrada por (cartao,
 * competencia): cartoes na ordem recebida e, dentro do cartao, a competencia mais
 * antiga primeiro. Cartao repetido em `cards` e responsabilidade de quem chama.
 */
export function missingStatements(input: {
  today: IsoDate;
  cards: readonly ({ id: string } & CardCycleConfig)[];
  /**
   * Faturas existentes dos cartoes. Precisa trazer o HISTORICO (toda competencia ate a
   * corrente), nao so as duas olhadas: e uma fatura mais antiga que a anterior que diz se
   * a anterior e buraco ou comeco. Competencia futura e ignorada.
   */
  statements: readonly { creditCardId: string; period: Competence }[];
}): MissingStatement[] {
  // `toCompetence` valida a data: `today` invalido lanca aqui, sem fallback.
  const competences = missingStatementCompetences(input.today);
  const [previous] = competences;
  // Chave composta com separador que nao ocorre em competencia ('YYYY-MM').
  const key = (creditCardId: string, competence: Competence) => `${competence}|${creditCardId}`;
  const imported = new Set(input.statements.map((statement) => key(statement.creditCardId, statement.period)));
  // Cartoes com fatura ANTES da competencia anterior: so neles a anterior pode ser buraco.
  // 'YYYY-MM' ordena como string na ordem cronologica.
  const hasEarlierHistory = new Set(
    input.statements.filter((statement) => statement.period < previous).map((statement) => statement.creditCardId),
  );

  const missing: MissingStatement[] = [];
  for (const card of input.cards) {
    for (const competence of competences) {
      if (imported.has(key(card.id, competence))) continue;
      if (competence === previous && !hasEarlierHistory.has(card.id)) continue;
      const { closingDate, dueDate } = statementWindow(competence, {
        closingDay: card.closingDay,
        dueDay: card.dueDay,
      });
      // Comparacao de string 'YYYY-MM-DD' e comparacao cronologica (ver billing.ts).
      if (closingDate < input.today) {
        missing.push({ creditCardId: card.id, competence, closingDate, dueDate });
      }
    }
  }
  return missing;
}

/**
 * As competencias que a regra olha, da mais antiga para a mais nova: a anterior e a
 * corrente. Exportada para a consulta ler exatamente as faturas que a regra usa.
 */
export function missingStatementCompetences(today: IsoDate): [Competence, Competence] {
  const current = toCompetence(today);
  return [addCompetence(current, -1), current];
}
