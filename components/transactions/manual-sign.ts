/**
 * Sinal do valor no "Novo lancamento" — decisao do Ricardo (2026-10-02).
 *
 * Despesa e Receita: a pessoa digita o valor **positivo** e o sinal vem do
 * **tipo** (Despesa grava negativo, Receita grava positivo). Transferencia,
 * Pagamento de fatura e Aporte continuam com o sinal digitado.
 *
 * Por que a regra mora numa funcao pura e testada, e nao inline no JSX: o
 * sistema usa o **sinal**, nao o `kind`, para a direcao do dinheiro, e nem a API
 * nem `createManualTransaction` validam sinal. Um erro aqui gravaria todo
 * lancamento com a direcao errada. O `.tsx` so chama.
 *
 * Caso de borda do aceite: quem digitar "-12,34" numa **Despesa** continua
 * gravando -1234, e nao vira positivo — por isso `expense` usa `-abs`. `income`
 * usa `+abs` pela mesma logica: o sinal e do tipo.
 */

import { cents, type Cents } from '@/lib/money';

/** Tipos que o formulario de criacao aceita (mesma uniao de `ManualValues['kind']`). */
export type ManualAmountKind =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'credit_card_payment'
  | 'investment_contribution';

/**
 * Aplica o sinal ao valor ja lido por `parseBRL`.
 *
 * - `expense` -> `-abs(valor)` (digitar "-" nao inverte);
 * - `income` -> `+abs(valor)`;
 * - os demais -> valor como digitado (sinal literal).
 *
 * `cents()` normaliza `-0` para `0`.
 */
export function signedAmountCents(amountCents: Cents, kind: ManualAmountKind): Cents {
  if (kind === 'expense') return cents(-Math.abs(amountCents));
  if (kind === 'income') return cents(Math.abs(amountCents));
  return cents(amountCents);
}
