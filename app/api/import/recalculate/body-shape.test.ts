/**
 * Teste de fronteira: o body que a tela monta EXATAMENTE como em
 * `components/import/import-confirmation.tsx:226+` passa por
 * `recalculateBodySchema`? Foi a regressão que pegou o Ricardo em produção:
 * o schema tinha `statementCompetence: competenceSchema.nullable()` (chave
 * obrigatória) e a tela mandava sem o campo — 400 em todo recalculate e o
 * rodapé caía para o total do preview (que inclui a linha de pagamento).
 *
 * Esta defesa é o teste de "duas pontas de um contrato que nenhuma ferramenta
 * compara" — ele monta o body do jeito que a tela monta e verifica no schema.
 * Se alguém mexer num dos lados sem mexer no outro, este teste cai.
 */

import { describe, expect, it } from 'vitest';

import { recalculateResponseSchema } from '@/components/import/schemas';
import { finalizeImport } from '@/lib/import/pipeline';
import { summarizeStillHeld } from '@/lib/import/still-held';
import { cents } from '@/lib/money';

import { countRows } from './counts';
import { recalculateBodySchema } from './schema';

/** Body EXATO que `components/import/import-confirmation.tsx` envia hoje. */
function buildRecalculateBodyFromScreen({
  sourceKind,
  defaultCompetence,
}: {
  sourceKind: 'credit_card' | 'account';
  defaultCompetence: string;
}) {
  // Se o tipo for cartão, manda a competência. Se for conta, manda null.
  const statementCompetence = sourceKind === 'credit_card' ? defaultCompetence : null;
  return {
    sourceKind,
    sourceId: '11111111-1111-4111-8111-111111111111',
    cardCycle:
      sourceKind === 'credit_card'
        ? { closingDay: 3, dueDay: 10 }
        : null,
    rows: [
      {
        index: 0,
        include: false, // <-- esta é a linha de pagamento, desmarcada
        occurredOn: '2026-09-15',
        description: 'PAGAMENTO DA FATURA ANTERIOR',
        rawDescription: 'PAGAMENTO DA FATURA ANTERIOR',
        amountCents: -1200000,
        categoryId: null,
        memberId: null,
        installment: null,
      },
      {
        index: 1,
        include: true,
        occurredOn: '2026-09-10',
        description: 'MERCADO TESTE',
        rawDescription: 'MERCADO TESTE',
        amountCents: -5000,
        categoryId: '11111111-1111-4111-8111-111111111112',
        memberId: null,
        installment: null,
      },
    ],
    statementCompetence,
  };
}

describe('recalculateBodySchema — body que a tela monta', () => {
  it('aceita o body do recalculate para cartão com competence (caso real da regressão)', () => {
    const body = buildRecalculateBodyFromScreen({
      sourceKind: 'credit_card',
      defaultCompetence: '2026-09',
    });
    const result = recalculateBodySchema.safeParse(body);
    expect(result.success).toBe(true);
  });

  it('aceita o body do recalculate para conta com statementCompetence=null', () => {
    const body = buildRecalculateBodyFromScreen({
      sourceKind: 'account',
      defaultCompetence: '2026-09',
    });
    const result = recalculateBodySchema.safeParse(body);
    expect(result.success).toBe(true);
  });

  it('rejeita o body do recalculate sem statementCompetence (chave obrigatória — 400 alto)', () => {
    // Lição do bug do Ricardo: se a chave puder faltar, o pipeline cai em
    // `competenceFor(occurredOn)` e calcula a competência pela data da
    // compra. Em silêncio. Isso É o G-07 — parcela 11/12 voltaria para
    // 2025-11 em vez de 2026-09. Falta de info obrigatória tem de falhar alto,
    // não silenciar.
    const body = buildRecalculateBodyFromScreen({
      sourceKind: 'credit_card',
      defaultCompetence: '2026-09',
    });
    const { statementCompetence: _omit, ...withoutCompetence } = body;
    void _omit;
    const result = recalculateBodySchema.safeParse(withoutCompetence);
    expect(result.success).toBe(false);
  });

  it('aceita statementCompetence explícito como null', () => {
    const body = buildRecalculateBodyFromScreen({
      sourceKind: 'account',
      defaultCompetence: '2026-09',
    });
    const result = recalculateBodySchema.safeParse(body);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.statementCompetence).toBeNull();
    }
  });

  it('plannedRowsCount NÃO é campo de entrada (é da resposta)', () => {
    const body = buildRecalculateBodyFromScreen({
      sourceKind: 'credit_card',
      defaultCompetence: '2026-09',
    });
    const result = recalculateBodySchema.safeParse(body);
    expect(result.success).toBe(true);
    if (result.success) {
      expect('plannedRowsCount' in result.data).toBe(false);
    }
  });

  it('rejeita competence em formato errado (sanity)', () => {
    const body = buildRecalculateBodyFromScreen({
      sourceKind: 'credit_card',
      defaultCompetence: '2026-09',
    });
    const bad = { ...body, statementCompetence: '2026/09' };
    const result = recalculateBodySchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

/**
 * A outra ponta: o que a rota devolve passa por `recalculateResponseSchema`,
 * que é o que a tela usa em `.parse(body)`. Se a rota esquecer um campo, o
 * `.parse` lança na tela — e nenhuma ferramenta compara as duas pontas.
 */
describe('resposta do recalculate — o que a tela faz parse', () => {
  const row = (index: number, installment: { current: number; total: number } | null) => ({
    index,
    include: true,
    occurredOn: '2026-09-10',
    description: `COMPRA ${String(index)}`,
    rawDescription: `COMPRA ${String(index)}`,
    amountCents: cents(-5000),
    categoryId: null,
    memberId: null,
    installment,
  });

  function respond(rows: ReturnType<typeof row>[]) {
    const result = finalizeImport({
      rows,
      sourceId: '11111111-1111-4111-8111-111111111111',
      sourceKind: 'credit_card',
      cardCycle: { closingDay: 3, dueDay: 10 },
      existingHashes: new Set<string>(),
      reportedTotalCents: null,
      statementCompetence: '2026-09',
    });
    return {
      totalCents: result.totals.includedCents,
      ...countRows(rows.length, result),
      competenceByIndex: rows.map((r) => ({ index: r.index, competence: '2026-09' })),
      stillHeld: summarizeStillHeld(result),
    };
  }

  it('"Ainda presos" fecha com o contador do rodape: uma parcela futura, um canhoto preso', () => {
    const body = respond([row(0, { current: 2, total: 5 }), row(1, { current: 1, total: 2 }), row(2, null)]);
    expect(body.stillHeld.count).toBe(body.plannedRowsCount);
    expect(body.stillHeld.months.map((month) => month.competence)).toEqual(['2026-10', '2026-11', '2026-12']);
    // O schema atual da tela ignora a chave nova sem quebrar (z.object descarta).
    expect(recalculateResponseSchema.safeParse(body).success).toBe(true);
  });

  it('sem parcelas: nenhuma futura, e o schema da tela aceita', () => {
    const body = respond([row(0, null), row(1, null)]);
    expect(body.includedRowsCount).toBe(2);
    expect(body.plannedRowsCount).toBe(0);
    expect(recalculateResponseSchema.safeParse(body).success).toBe(true);
  });

  it('compra 2/5 gera 3 futuras (3/5 a 5/5), não 4', () => {
    const body = respond([row(0, { current: 2, total: 5 })]);
    expect(body.plannedRowsCount).toBe(3);
    expect(body.includedRowsCount).toBe(4); // 1 marcada + 3 futuras
    expect(recalculateResponseSchema.safeParse(body).success).toBe(true);
  });

  it('linha desmarcada não conta como marcada nem gera futuras', () => {
    const unchecked = { ...row(1, { current: 1, total: 4 }), include: false };
    const body = respond([row(0, null), unchecked]);
    expect(body.includedRowsCount).toBe(1);
    expect(body.plannedRowsCount).toBe(0);
  });

  it('a resposta sem plannedRowsCount é rejeitada (falha alto)', () => {
    const { plannedRowsCount: _omit, ...withoutPlanned } = respond([row(0, null)]);
    void _omit;
    expect(recalculateResponseSchema.safeParse(withoutPlanned).success).toBe(false);
  });
});
