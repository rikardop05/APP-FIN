import { describe, expect, it } from 'vitest';
import { settleStatement } from './statement-settlement';

describe('settleStatement: pago e pendente de uma fatura', () => {
  it('nao paga: tudo pendente', () => {
    expect(settleStatement({ status: 'open', computedTotalCents: -100000, paidAmountCents: null })).toMatchObject({ kind: 'none', totalCents: 100000, paidCents: 0, pendingCents: 100000 });
    expect(settleStatement({ status: 'closed', computedTotalCents: -5000, paidAmountCents: 999 })).toMatchObject({ kind: 'none', paidCents: 0, pendingCents: 5000 });
  });
  it('paga integral: tudo pago', () => {
    expect(settleStatement({ status: 'paid', computedTotalCents: -100000, paidAmountCents: null })).toMatchObject({ kind: 'full', paidCents: 100000, pendingCents: 0, remainingCents: null });
    expect(settleStatement({ status: 'paid', computedTotalCents: -100000, paidAmountCents: 100000 })).toMatchObject({ kind: 'full', pendingCents: 0 });
  });
  it('parcial: pago e resta somam o total', () => {
    const s = settleStatement({ status: 'paid', computedTotalCents: -100000, paidAmountCents: 40000 });
    expect(s).toMatchObject({ kind: 'partial', paidCents: 40000, pendingCents: 60000, remainingCents: 60000 });
    expect(s.paidCents + s.pendingCents).toBe(s.totalCents);
  });
  it('saldo credor: nao deve nada, pendente 0 (alinhado ao comprometido)', () => {
    expect(settleStatement({ status: 'open', computedTotalCents: 8000, paidAmountCents: null })).toMatchObject({ kind: 'none', totalCents: 0, paidCents: 0, pendingCents: 0 });
    expect(settleStatement({ status: 'paid', computedTotalCents: 8000, paidAmountCents: null })).toMatchObject({ kind: 'full', totalCents: 0, pendingCents: 0 });
  });
  it('a maior: pago limitado ao total, excedente a parte', () => {
    expect(settleStatement({ status: 'paid', computedTotalCents: -100000, paidAmountCents: 120000 })).toMatchObject({ kind: 'over', paidCents: 100000, pendingCents: 0, overpaidCents: 20000 });
  });
});
