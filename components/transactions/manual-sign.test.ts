import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';
import { signedAmountCents } from './manual-sign';

/**
 * Decisao do Ricardo (2026-10-02): em Despesa e Receita o sinal vem do TIPO; nos
 * demais, o sinal digitado e preservado. Estes casos sao o aceite da tarefa.
 */
describe('signedAmountCents', () => {
  it('despesa positiva digitada vira negativa', () => {
    expect(signedAmountCents(cents(1234), 'expense')).toBe(-1234);
  });

  it('receita positiva digitada permanece positiva', () => {
    expect(signedAmountCents(cents(1234), 'income')).toBe(1234);
  });

  it('despesa digitada ja com "-" continua negativa (nao vira positiva)', () => {
    expect(signedAmountCents(cents(-1234), 'expense')).toBe(-1234);
  });

  it('receita digitada com "-" tambem segue o tipo (positiva)', () => {
    // O sinal e do tipo; o "-" digitado nao inverte a Receita.
    expect(signedAmountCents(cents(-1234), 'income')).toBe(1234);
  });

  it('transferencia preserva o sinal digitado', () => {
    expect(signedAmountCents(cents(1234), 'transfer')).toBe(1234);
    expect(signedAmountCents(cents(-1234), 'transfer')).toBe(-1234);
  });

  it('pagamento de fatura e aporte preservam o sinal digitado', () => {
    expect(signedAmountCents(cents(-5000), 'credit_card_payment')).toBe(-5000);
    expect(signedAmountCents(cents(-10000), 'investment_contribution')).toBe(-10000);
    expect(signedAmountCents(cents(10000), 'investment_contribution')).toBe(10000);
  });

  it('zero permanece zero, sem "-0", em qualquer tipo', () => {
    expect(signedAmountCents(cents(0), 'expense')).toBe(0);
    expect(signedAmountCents(cents(0), 'income')).toBe(0);
    expect(signedAmountCents(cents(0), 'transfer')).toBe(0);
    expect(Object.is(signedAmountCents(cents(0), 'expense'), -0)).toBe(false);
  });
});
