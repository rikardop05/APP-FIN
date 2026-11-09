import { describe, expect, it } from 'vitest';
import {
  isOverdueUnpaid,
  OVERDUE_UNPAID_HINT,
  paidButtonAriaLabel,
  paidButtonLabel,
  paidErrorMessage,
  paidSuccessMessage,
  parsePaymentChoice,
  paymentKind,
  statusRequestBody,
  statementStatusResponseSchema,
  targetStatus,
} from './statement-paid';

describe('pagamento integral ou valor personalizado', () => {
  it('classifica o pagamento', () => {
    expect(paymentKind({ status: 'open', remainingCents: null, overpaidCents: null })).toBe('none');
    expect(paymentKind({ status: 'paid', remainingCents: null, overpaidCents: null })).toBe('full');
    expect(paymentKind({ status: 'paid', remainingCents: 5000, overpaidCents: null })).toBe('partial');
    expect(paymentKind({ status: 'paid', remainingCents: null, overpaidCents: 100 })).toBe('over');
  });
  it('integral nao manda valor; outro valor vira centavos', () => {
    expect(parsePaymentChoice({ mode: 'full', text: 'lixo' })).toEqual({ ok: true });
    expect(parsePaymentChoice({ mode: 'custom', text: '350,00' })).toEqual({ ok: true, paidAmountCents: 35000 });
    expect(parsePaymentChoice({ mode: 'custom', text: '' }).ok).toBe(false);
    expect(parsePaymentChoice({ mode: 'custom', text: 'abc' }).ok).toBe(false);
    expect(parsePaymentChoice({ mode: 'custom', text: '0,00' })).toEqual({ ok: false, error: 'O valor pago precisa ser maior que zero.' });
  });
  it('corpo da requisicao', () => {
    expect(statusRequestBody('paid')).toEqual({ status: 'paid' });
    expect(statusRequestBody('paid', 35000)).toEqual({ status: 'paid', paidAmountCents: 35000 });
    expect(statusRequestBody('open', 35000)).toEqual({ status: 'open' });
  });
  it('mensagem de pagamento parcial', () => {
    expect(paidSuccessMessage('paid', true)).toContain('parcial');
  });
});

describe('marcar fatura como paga', () => {
  it('alterna entre paga e aberta', () => {
    expect(targetStatus('open')).toBe('paid');
    expect(targetStatus('closed')).toBe('paid');
    expect(targetStatus('paid')).toBe('open');
  });
  it('o botao nomeia a acao e a fatura', () => {
    expect(paidButtonLabel('open')).toBe('Marcar como paga');
    expect(paidButtonLabel('paid')).toBe('Desmarcar como paga');
    expect(paidButtonAriaLabel('open', 'out/2026')).toBe('Marcar como paga: fatura de out/2026');
    expect(paidButtonAriaLabel('open', 'out/2026', 'Nubank')).toBe('Marcar como paga: fatura de out/2026 (Nubank)');
    expect(paidButtonAriaLabel('paid', 'set/2026', '')).toBe('Desmarcar como paga: fatura de set/2026');
  });
  it('feedback diz o efeito no comprometido', () => {
    expect(paidSuccessMessage('paid')).toContain('saiu da conta');
    expect(paidSuccessMessage('open')).toContain('voltou a contar');
  });
  it('erro usa a mensagem da rota ou um texto em pt-BR por status', () => {
    expect(paidErrorMessage(404, { error: 'Fatura não encontrada.' })).toBe('Fatura não encontrada.');
    expect(paidErrorMessage(401, null)).toContain('sessão');
    expect(paidErrorMessage(404, {})).toContain('não encontrada');
    expect(paidErrorMessage(500, 'x')).toContain('Não foi possível');
  });
  it('valida a resposta da rota', () => {
    const ok = statementStatusResponseSchema.safeParse({ id: '11111111-1111-4111-8111-111111111111', status: 'paid' });
    expect(ok.success).toBe(true);
    expect(statementStatusResponseSchema.safeParse({ id: 'x', status: 'paid' }).success).toBe(false);
  });
});

describe('vencida e nao paga', () => {
  it('so conta quando venceu e nao esta paga', () => {
    expect(isOverdueUnpaid({ status: 'open', dueDate: '2026-09-10' }, '2026-10-08')).toBe(true);
    expect(isOverdueUnpaid({ status: 'closed', dueDate: '2026-09-10' }, '2026-10-08')).toBe(true);
    expect(isOverdueUnpaid({ status: 'paid', dueDate: '2026-09-10' }, '2026-10-08')).toBe(false);
    expect(isOverdueUnpaid({ status: 'open', dueDate: '2026-10-08' }, '2026-10-08')).toBe(false);
    expect(OVERDUE_UNPAID_HINT).toContain('comprometido');
  });
});
