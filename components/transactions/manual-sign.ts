/**
 * Sinal do valor nos formularios de lancamento — decisao do Ricardo (2026-10-02).
 *
 * Despesa e Receita: a pessoa digita (ou edita) o valor **sem sinal** e o sinal
 * vem do **tipo** (Despesa grava negativo, Receita grava positivo). Transferencia,
 * Pagamento de fatura e Aporte continuam com o sinal digitado.
 *
 * Por que a regra mora numa funcao pura e testada, e nao inline no JSX: o
 * sistema usa o **sinal**, nao o `kind`, para a direcao do dinheiro, e nem a API
 * nem `createManualTransaction` validam sinal. Um erro aqui gravaria todo
 * lancamento com a direcao errada. Os `.tsx` so chamam.
 *
 * Duas pontas, uma regra so:
 * - `amountForInput` — o que o campo MOSTRA (Despesa/Receita sem sinal);
 * - `signedAmountCents` — o que a gravacao GRAVA (sinal do tipo).
 *
 * Caso de borda: quem digitar "-12,34" numa **Despesa** continua gravando -1234,
 * e nao vira positivo — `amountForInput` usa `abs`, entao `signedAmountCents`
 * reaplica o sinal do tipo. `income` segue a mesma logica (`+abs`).
 */

import { cents, type Cents } from '@/lib/money';

/** Tipos que os formularios aceitam (mesma uniao de `Transaction['kind']`). */
export type ManualAmountKind =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'credit_card_payment'
  | 'investment_contribution';

/**
 * Valor a EXIBIR no campo, em centavos: Despesa e Receita sem sinal (o tipo
 * define a direcao); os demais preservam o sinal. `cents()` normaliza `-0`.
 */
export function amountForInput(amountCents: Cents, kind: ManualAmountKind): Cents {
  if (kind === 'expense' || kind === 'income') return cents(Math.abs(amountCents));
  return cents(amountCents);
}

/**
 * Aplica o sinal do tipo ao valor lido por `parseBRL`, para GRAVAR:
 * `expense` -> negativo; `income` -> positivo; os demais -> como digitado.
 */
export function signedAmountCents(amountCents: Cents, kind: ManualAmountKind): Cents {
  const magnitude = amountForInput(amountCents, kind);
  return kind === 'expense' ? cents(-magnitude) : magnitude;
}
