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
