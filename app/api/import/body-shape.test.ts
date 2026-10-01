/**
 * Teste de fronteira: o body que a tela monta EXATAMENTE como em
 * `components/import/import-confirmation.tsx:294+` passa por `commitBodySchema`?
 *
 * O `commitBodySchema` usa `discriminatedUnion('sourceKind')`:
 * - cartão → `defaultCompetence: competenceSchema` (obrigatório)
 * - conta   → `defaultCompetence: competenceSchema.optional()`
 *
 * Este teste existe para garantir que um caller futuro que esqueça `defaultCompetence`
 * na rota de cartão cai em 400 com mensagem clara, em vez do commit ficar
 * aceitando sem competência e gravar fatura com `period` errado. Mesmo
 * padrão do `body-shape.test.ts` irmão em `/recalculate`.
 */

import { describe, expect, it } from 'vitest';

import { commitBodySchema } from './schemas';

/** Body EXATO que `components/import/import-confirmation.tsx` envia hoje. */
function buildCommitBodyFromScreen({
  sourceKind,
  defaultCompetence,
}: {
  sourceKind: 'credit_card' | 'account';
  defaultCompetence: string;
}) {
  return {
    fileName: 'fatura-2026-09.pdf',
    fileHash: 'a'.repeat(64),
    bankKey: 'santander',
    format: 'pdf' as const,
    sourceKind,
    sourceId: '11111111-1111-4111-8111-111111111111',
    confirmedRows: [
      {
        index: 0,
        include: false,
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
    reportedTotalCents: null,
    allowReimport: false,
    defaultCompetence,
  };
}

describe('commitBodySchema — body que a tela monta', () => {
  it('aceita o body do commit para cartão com defaultCompetence', () => {
    const body = buildCommitBodyFromScreen({
      sourceKind: 'credit_card',
      defaultCompetence: '2026-09',
    });
    const result = commitBodySchema.safeParse(body);
    expect(result.success).toBe(true);
  });

  it('aceita o body do commit para conta com defaultCompetence (opcional)', () => {
    const body = buildCommitBodyFromScreen({
      sourceKind: 'account',
      defaultCompetence: '2026-09',
    });
    const result = commitBodySchema.safeParse(body);
    expect(result.success).toBe(true);
  });

  it('rejeita cartão sem defaultCompetence (regra do uniao discriminada)', () => {
    const body = buildCommitBodyFromScreen({
      sourceKind: 'credit_card',
      defaultCompetence: '2026-09',
    });
    const { defaultCompetence: _omit, ...withoutCompetence } = body;
    void _omit;
    const result = commitBodySchema.safeParse(withoutCompetence);
    expect(result.success).toBe(false);
  });

  it('aceita conta sem defaultCompetence (campo opcional)', () => {
    const body = buildCommitBodyFromScreen({
      sourceKind: 'account',
      defaultCompetence: '2026-09',
    });
    const { defaultCompetence: _omit, ...withoutCompetence } = body;
    void _omit;
    const result = commitBodySchema.safeParse(withoutCompetence);
    expect(result.success).toBe(true);
  });
});
