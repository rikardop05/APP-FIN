import { z } from 'zod';

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

/** O estado para o qual o botão leva: paga vira aberta, qualquer outra vira paga. */
export function targetStatus(current: StatementStatus): 'paid' | 'open' {
  return current === 'paid' ? 'open' : 'paid';
}

/** Texto do botão (nomeia a ação, não "OK"). */
export function paidButtonLabel(current: StatementStatus): string {
  return current === 'paid' ? 'Desmarcar como paga' : 'Marcar como paga';
}

/** Nome acessível do botão: diz qual fatura (a competência já vem formatada pelo chamador). */
export function paidButtonAriaLabel(current: StatementStatus, periodLabel: string): string {
  return `${paidButtonLabel(current)}: fatura de ${periodLabel}`;
}

/** Feedback de sucesso. */
export function paidSuccessMessage(next: 'paid' | 'open'): string {
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
