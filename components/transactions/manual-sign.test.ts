import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';
import { amountForInput, signedAmountCents } from './manual-sign';

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

/**
 * Preenchimento do CAMPO: Despesa/Receita aparecem sem sinal (o tipo define a
 * direcao); os demais mostram o sinal. E o que o editor de lancamento gravado e o
 * formulario de criacao exibem.
 */
describe('amountForInput', () => {
  it('despesa e receita aparecem sem sinal, nos dois sentidos', () => {
    expect(amountForInput(cents(-5000), 'expense')).toBe(5000);
    expect(amountForInput(cents(5000), 'expense')).toBe(5000);
    expect(amountForInput(cents(5000), 'income')).toBe(5000);
    expect(amountForInput(cents(-5000), 'income')).toBe(5000);
  });

  it('os outros tipos preservam o sinal digitado', () => {
    expect(amountForInput(cents(-5000), 'transfer')).toBe(-5000);
    expect(amountForInput(cents(5000), 'transfer')).toBe(5000);
    expect(amountForInput(cents(-5000), 'credit_card_payment')).toBe(-5000);
    expect(amountForInput(cents(-10000), 'investment_contribution')).toBe(-10000);
  });

  it('zero permanece zero, sem "-0"', () => {
    expect(amountForInput(cents(0), 'expense')).toBe(0);
    expect(Object.is(amountForInput(cents(0), 'expense'), -0)).toBe(false);
  });

  it('ida e volta: exibir e gravar preserva o sinal do tipo', () => {
    // O editor mostra sem sinal e grava com o sinal do tipo: -5000 expense
    // continua -5000 depois de editar sem mexer no sinal.
    expect(signedAmountCents(amountForInput(cents(-5000), 'expense'), 'expense')).toBe(-5000);
    expect(signedAmountCents(amountForInput(cents(5000), 'income'), 'income')).toBe(5000);
    // Os literais tambem sobrevivem a ida e volta.
    expect(signedAmountCents(amountForInput(cents(-7000), 'transfer'), 'transfer')).toBe(-7000);
  });

  it('despesa positiva pre-existente e corrigida ao editar', () => {
    // Dado inconsistente antigo (despesa gravada positiva): exibir abs e gravar
    // com o sinal do tipo conserta para negativo, sem o usuario perceber.
    expect(signedAmountCents(amountForInput(cents(5000), 'expense'), 'expense')).toBe(-5000);
  });
});
