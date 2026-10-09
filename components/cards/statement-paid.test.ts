import { describe, expect, it } from 'vitest';
import {
  isOverdueUnpaid,
  OVERDUE_UNPAID_HINT,
  paidButtonAriaLabel,
  paidButtonLabel,
  paidErrorMessage,
  paidSuccessMessage,
  statementStatusResponseSchema,
  targetStatus,
} from './statement-paid';

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
