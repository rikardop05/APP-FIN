import { describe, expect, it } from 'vitest';
import { cents } from '@/lib/money';
import {
  applyBulk,
  bankLabel,
  confirmBlockReason,
  firstInvalidIndex,
  flaggedIndexes,
  placarFigures,
  rowFieldLabel,
  rowFlags,
  stepFlagged,
} from './review-model';

const clean = { state: 'new', lowConfidence: false, invalid: false } as const;

describe('rowFlags', () => {
  it('linha limpa não tem sinal', () => {
    expect(rowFlags(clean)).toEqual([]);
    expect(rowFlags({ ...clean, state: 'installment_part' })).toEqual([]);
  });

  it('ordena do mais grave ao menos grave', () => {
    expect(rowFlags({ state: 'duplicate', lowConfidence: true, invalid: true })).toEqual([
      'invalid',
      'low_confidence',
      'duplicate',
    ]);
  });

  it('pagamento e informativa são sinalizadas', () => {
    expect(rowFlags({ ...clean, state: 'credit_card_payment' })).toEqual(['payment']);
    expect(rowFlags({ ...clean, state: 'informational' })).toEqual(['informational']);
  });
});

describe('J e K entre linhas sinalizadas', () => {
  const flagged = [2, 5, 9];

  it('J avança e dá a volta', () => {
    expect(stepFlagged(flagged, null, 1)).toBe(2);
    expect(stepFlagged(flagged, 2, 1)).toBe(5);
    expect(stepFlagged(flagged, 9, 1)).toBe(2);
  });

  it('K recua e dá a volta', () => {
    expect(stepFlagged(flagged, null, -1)).toBe(9);
    expect(stepFlagged(flagged, 5, -1)).toBe(2);
    expect(stepFlagged(flagged, 2, -1)).toBe(9);
  });

  it('parte de uma linha não sinalizada', () => {
    expect(stepFlagged(flagged, 3, 1)).toBe(5);
    expect(stepFlagged(flagged, 3, -1)).toBe(2);
  });

  it('sem sinalizadas devolve null', () => {
    expect(stepFlagged([], null, 1)).toBeNull();
  });

  it('flaggedIndexes lista só as sinalizadas', () => {
    const rows = [
      { index: 0, ...clean },
      { index: 1, ...clean, state: 'duplicate' as const },
      { index: 2, ...clean, invalid: true },
    ];
    expect(flaggedIndexes(rows)).toEqual([1, 2]);
    expect(firstInvalidIndex(rows)).toBe(2);
    expect(firstInvalidIndex([{ index: 0, invalid: false }])).toBeNull();
  });
});

describe('confirmBlockReason', () => {
  const ok = { busy: false, recalculating: false, invalidCount: 0, includedCount: 3 };

  it('livre quando tudo confere', () => {
    expect(confirmBlockReason(ok)).toBeNull();
  });

  it('diz o motivo, no singular e no plural', () => {
    expect(confirmBlockReason({ ...ok, invalidCount: 1 })).toMatch(/^1 linha incluída está incompleta/);
    expect(confirmBlockReason({ ...ok, invalidCount: 3 })).toMatch(/^3 linhas incluídas estão incompletas/);
    expect(confirmBlockReason({ ...ok, includedCount: 0 })).toMatch(/Nenhuma linha incluída/);
    expect(confirmBlockReason({ ...ok, recalculating: true })).toMatch(/Recalculando/);
    expect(confirmBlockReason({ ...ok, busy: true })).toMatch(/Gravando/);
  });
});

describe('rowFieldLabel', () => {
  it('leva o número e a descrição da linha', () => {
    expect(rowFieldLabel('Categoria', 5, 'PADARIA X')).toBe('Categoria da linha 5, PADARIA X');
    expect(rowFieldLabel('Valor', 2, '  ')).toBe('Valor da linha 2');
  });
});

describe('placarFigures', () => {
  it('zera quando o lote bate com o total impresso', () => {
    const figures = placarFigures({ reportedTotalCents: cents(-12345), totalCents: cents(-12345) });
    expect(figures).toMatchObject({ reportedCents: 12345, includedCents: 12345, differenceCents: 0, tone: 'ok' });
  });

  it('diverge com o sinal do sistema', () => {
    const figures = placarFigures({ reportedTotalCents: cents(-12345), totalCents: cents(-10000) });
    expect(figures.differenceCents).toBe(2345);
    expect(figures.tone).toBe('danger');
  });

  it('sem total impresso fica neutro', () => {
    const figures = placarFigures({ reportedTotalCents: null, totalCents: cents(-500) });
    expect(figures).toMatchObject({ reportedCents: null, differenceCents: null, tone: 'neutral' });
  });
});

describe('applyBulk', () => {
  const rows = [
    { index: 0, suggestedCategoryId: 'a', suggestedMemberId: 'm' },
    { index: 1, suggestedCategoryId: 'b', suggestedMemberId: null },
  ];

  it('muda só as selecionadas e só o campo informado', () => {
    const out = applyBulk(rows, new Set([1]), { categoryId: 'z' });
    expect(out[0]).toBe(rows[0]);
    expect(out[1]).toEqual({ index: 1, suggestedCategoryId: 'z', suggestedMemberId: null });
  });

  it('null limpa o campo; undefined não mexe', () => {
    const out = applyBulk(rows, new Set([0]), { memberId: null });
    expect(out[0]).toEqual({ index: 0, suggestedCategoryId: 'a', suggestedMemberId: null });
  });
});

describe('bankLabel', () => {
  it('nomeia os emissores conhecidos e não quebra nos outros', () => {
    expect(bankLabel('nubank_card')).toBe('Nubank');
    expect(bankLabel('inter_card')).toBe('Inter');
    expect(bankLabel('santander')).toBe('Santander');
    expect(bankLabel(null)).toBe('Emissor não identificado');
  });
});

import { announcementFor, successMessage, type AnnounceState } from './review-model';

describe('announcementFor: só mudanças relevantes', () => {
  const quiet: AnnounceState = { invalidCount: 0, tone: 'neutral', differenceCents: null, committed: false };

  it('editar sem mudar de estado não anuncia', () => {
    const ok = { ...quiet, tone: 'ok' as const };
    expect(announcementFor(ok, ok)).toBeNull();
    expect(announcementFor({ ...quiet, invalidCount: 2 }, { ...quiet, invalidCount: 3 })).toBeNull();
  });

  it('anuncia o placar mudando de estado, uma vez', () => {
    expect(announcementFor(quiet, { ...quiet, tone: 'ok' })).toBe('O lote confere com o total da fatura.');
    expect(announcementFor({ ...quiet, tone: 'ok' }, { ...quiet, tone: 'danger' })).toBe('O lote diverge do total da fatura.');
    expect(announcementFor({ ...quiet, tone: 'danger' }, { ...quiet, tone: 'neutral' })).toBeNull();
  });

  it('anuncia a primeira linha inválida e o fim das inválidas', () => {
    expect(announcementFor(quiet, { ...quiet, invalidCount: 1 })).toBe('1 linha incluída está incompleta.');
    expect(announcementFor(quiet, { ...quiet, invalidCount: 3 })).toBe('3 linhas incluídas estão incompletas.');
    expect(announcementFor({ ...quiet, invalidCount: 1 }, quiet)).toBe('Nenhuma linha incompleta.');
  });

  it('anuncia o lote confirmado e depois cala', () => {
    const done = { ...quiet, committed: true };
    expect(announcementFor(quiet, done)).toBe('Lote confirmado.');
    expect(announcementFor(done, { ...done, tone: 'ok' })).toBeNull();
  });
});

describe('successMessage', () => {
  it('sem conciliação, só confirma', () => {
    expect(successMessage({ plannedReconciled: 0, installmentsReconciled: 0 })).toBe(
      'Importação confirmada. Os canhotos foram destacados.',
    );
  });

  it('diz previsões cumpridas e parcelas conciliadas com planos existentes', () => {
    expect(successMessage({ plannedReconciled: 2, installmentsReconciled: 1 })).toContain(
      '2 previsões cumpridas e 1 parcela conciliada com plano existente.',
    );
    expect(successMessage({ plannedReconciled: 0, installmentsReconciled: 3 })).toContain(
      '3 parcelas conciliadas com planos existentes.',
    );
  });
});

import { confirmWithDifferenceLabel, mayBeMissing } from './review-model';

describe('P1b: o que pode explicar a diferença do placar', () => {
  const ok = { include: true, state: 'new' as const, lowConfidence: false };

  it('excluídas, duplicadas e de baixa confiança entram; linha normal incluída não', () => {
    expect(mayBeMissing(ok)).toBe(false);
    expect(mayBeMissing({ ...ok, include: false })).toBe(true);
    expect(mayBeMissing({ ...ok, state: 'duplicate' })).toBe(true);
    expect(mayBeMissing({ ...ok, lowConfidence: true })).toBe(true);
  });

  it('o rótulo do Confirmar leva o valor da diferença', () => {
    expect(confirmWithDifferenceLabel('R$ 30,00')).toBe('Confirmar com diferença de R$ 30,00');
  });
});
