import { describe, expect, it } from 'vitest';

import { detectInstallment } from '@/lib/import/installments';
import { buildImportPreview } from '@/lib/import/pipeline';
import { summarizeStillHeld } from '@/lib/import/still-held';
import { parsePastedText } from '@/lib/import/text';
import { finalizeImport } from '@/lib/import/pipeline';

/**
 * Revisao final, ponto (a): `LOJA X PARC 03/10` colado numa linha de 03/10 nao
 * virava parcela. O parser e o detector liam 3/10; quem descartava era o
 * desempate do preview ("`03/10` numa linha de 03/10 e a propria data"), que
 * deve valer so para o par SOLTO, nunca com evidencia direta (RF-IMP-03).
 */
describe('detectInstallment — marca de evidencia direta', () => {
  it('PARC e PARCELA saem marcados', () => {
    expect(detectInstallment('LOJA X PARC 03/10')?.marked).toBe(true);
    expect(detectInstallment('LOJA X - Parcela 3/10')?.marked).toBe(true);
    expect(detectInstallment('CASAS BAHIA PARCELA 3 DE 10')?.marked).toBe(true);
  });

  it('o par solto e o "N de M" sem palavra-chave nao sao marcados', () => {
    // Revisao do Corvo: "SEGURO VENC 3 de 10" tambem e vencimento em 3 de outubro.
    expect(detectInstallment('LOJA X 03/10')?.marked).toBeUndefined();
    expect(detectInstallment('LOJA X (3 de 10)')?.marked).toBeUndefined();
    expect(detectInstallment('SEGURO VENC 3 de 10')?.marked).toBeUndefined();
  });
});

const CARD = { closingDay: 10, dueDay: 20 };

function previewOf(text: string) {
  const parse = parsePastedText(text, { defaultCompetence: '2026-10' });
  return buildImportPreview({
    parse,
    sourceId: 'card-mp',
    sourceKind: 'credit_card',
    cardCycle: CARD,
    rules: [],
    existingHashes: new Set<string>(),
    today: '2026-10-09',
    statementCompetence: '2026-10',
  });
}

describe('texto colado — PARC nn/nn na linha de mesma data', () => {
  it('03/10 LOJA X PARC 03/10 R$ 89,90 e a parcela 3 de 10', () => {
    const row = previewOf('03/10 LOJA X PARC 03/10 R$ 89,90').rows[0];
    expect(row?.installment).toEqual({ current: 3, total: 10 });
    expect(row?.state).toBe('installment_part');
    expect(row?.description).toBe('LOJA X');
  });

  it('o par SOLTO igual a data continua sendo a data (desempate mantido)', () => {
    const row = previewOf('03/10 LOJA X 03/10 R$ 89,90').rows[0];
    expect(row?.installment).toBeNull();
  });

  it('"N de M" sem palavra-chave igual a data tambem continua sendo a data', () => {
    const row = previewOf('03/10 SEGURO VENC 3 de 10 R$ 89,90').rows[0];
    expect(row?.installment).toBeNull();
  });

  it('ponta a ponta: "Ainda presos" mostra as 7 restantes (4/10 a 10/10)', () => {
    const preview = previewOf('03/10 LOJA X PARC 03/10 R$ 89,90');
    const row = preview.rows[0];
    if (row === undefined || row.occurredOn === null || row.amountCents === null) {
      throw new Error('linha nao lida');
    }
    const result = finalizeImport({
      rows: [
        {
          index: row.index,
          include: true,
          occurredOn: row.occurredOn,
          description: row.description,
          rawDescription: row.rawDescription,
          amountCents: row.amountCents,
          categoryId: null,
          memberId: null,
          installment: row.installment,
        },
      ],
      sourceId: 'card-mp',
      sourceKind: 'credit_card',
      cardCycle: CARD,
      existingHashes: new Set<string>(),
      reportedTotalCents: null,
      statementCompetence: '2026-10',
    });
    const held = summarizeStillHeld(result);
    expect(held.count).toBe(7);
    expect(held.months[0]?.competence).toBe('2026-11');
    // Sinal literal do texto colado (text.ts, "Sinal do valor"): sem `-`, positivo.
    expect(held.totalCents).toBe(89_90 * 7);
  });
});
