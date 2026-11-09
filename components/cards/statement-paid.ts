import { z } from 'zod';

import { parseBRL } from '@/lib/money';

/**
 * Marcar e desmarcar fatura como paga (decisão do Ricardo, 2026-10-08). A rota é do Funil:
 * `POST /api/statements/{id}/status` com `{ status: 'paid' | 'open' }`, que devolve `{ id, status }`.
 * Fatura vencida e NÃO paga continua no comprometido; só esta marca explícita a tira. Lógica pura aqui
 * porque o vitest não transforma JSX.
 */

export type StatementStatus = 'open' | 'closed' | 'paid';

export const statementStatusResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['open', 'closed', 'paid']),
});

/** Como a fatura paga foi quitada: a lista escolhe selo e texto por isto. */
export type PaymentKind = 'none' | 'full' | 'partial' | 'over';

export function paymentKind(statement: { status: StatementStatus; remainingCents: number | null; overpaidCents: number | null }): PaymentKind {
  if (statement.status !== 'paid') return 'none';
  if (statement.remainingCents !== null) return 'partial';
  if (statement.overpaidCents !== null) return 'over';
  return 'full';
}

export type PaymentChoice = { mode: 'full' | 'custom'; text: string };

/**
 * O que o dialogo manda: integral = sem valor (o servidor grava null); outro valor = centavos > 0
 * lidos do campo de moeda por `parseBRL`. Texto vazio, invalido ou <= 0 devolve a mensagem de erro.
 */
export function parsePaymentChoice(choice: PaymentChoice): { ok: true; paidAmountCents?: number } | { ok: false; error: string } {
  if (choice.mode === 'full') return { ok: true };
  const parsed = parseBRL(choice.text);
  if (parsed === null || choice.text.trim() === '') return { ok: false, error: 'Informe o valor pago, por exemplo 350,00.' };
  if (parsed <= 0) return { ok: false, error: 'O valor pago precisa ser maior que zero.' };
  return { ok: true, paidAmountCents: parsed };
}

/** Corpo do POST: marcar (integral ou valor) ou desmarcar. */
export function statusRequestBody(next: 'paid' | 'open', paidAmountCents?: number): { status: 'paid' | 'open'; paidAmountCents?: number } {
  return next === 'paid' && paidAmountCents !== undefined ? { status: next, paidAmountCents } : { status: next };
}

/** O estado para o qual o botão leva: paga vira aberta, qualquer outra vira paga. */
export function targetStatus(current: StatementStatus): 'paid' | 'open' {
  return current === 'paid' ? 'open' : 'paid';
}

/** Texto do botão (nomeia a ação, não "OK"). */
export function paidButtonLabel(current: StatementStatus): string {
  return current === 'paid' ? 'Desmarcar como paga' : 'Marcar como paga';
}

/** Nome acessível do botão: diz qual fatura (a competência já vem formatada pelo chamador). */
export function paidButtonAriaLabel(current: StatementStatus, periodLabel: string, cardName?: string): string {
  const base = `${paidButtonLabel(current)}: fatura de ${periodLabel}`;
  return cardName === undefined || cardName === '' ? base : `${base} (${cardName})`;
}

/** Feedback de sucesso. */
export function paidSuccessMessage(next: 'paid' | 'open', partial = false): string {
  if (next === 'paid' && partial) return 'Pagamento parcial registrado. Só o que falta pagar continua no comprometido.';
  return next === 'paid'
    ? 'Fatura marcada como paga. Se estava na janela do comprometido, ela saiu da conta.'
    : 'Fatura desmarcada. Se está na janela do comprometido, ela voltou a contar.';
}

/** Mensagem de erro em pt-BR, usando a da rota quando houver (a rota já responde em português). */
export function paidErrorMessage(httpStatus: number | null, body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' && body.error !== '') {
    return body.error;
  }
  if (httpStatus === 401) return 'Sua sessão expirou. Entre de novo para continuar.';
  if (httpStatus === 404) return 'Fatura não encontrada. Atualize a página.';
  return 'Não foi possível atualizar a fatura. Tente de novo.';
}

/** Erro de rede (sem resposta). */
export const PAID_NETWORK_ERROR = 'Sem conexão com o servidor. Confira a internet e tente de novo.';

/**
 * Vencida e não paga: o vencimento já passou e a fatura não está marcada como paga. O app não sabe se
 * ela foi quitada, então continua no comprometido ATÉ a marca explícita (decisão de 2026-10-08), e a
 * tela avisa isso. `today` e `dueDate` são `YYYY-MM-DD` (comparação de texto ordena como data).
 */
export function isOverdueUnpaid(statement: { status: StatementStatus; dueDate: string }, today: string): boolean {
  return statement.status !== 'paid' && statement.dueDate < today;
}

export const OVERDUE_UNPAID_HINT =
  'Venceu e não está marcada como paga: continua contando no comprometido até você marcar.';
