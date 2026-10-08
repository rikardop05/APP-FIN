import type { TransactionKind } from '@/lib/db';
import type { Cents } from '@/lib/money';

/**
 * `kind` de um lançamento importado a partir do sinal do valor: saída negativa é `expense`,
 * entrada positiva é `income`.
 *
 * ZERO é recusado, com erro. Linha de valor zero é informativa (decisão 8): o `finalizeImport` a
 * manda para `skipped` com `reason: 'informational'` e ela nunca chega aqui. Se chegar, é defeito
 * de quem chamou, e o erro alto é melhor do que uma receita de R$ 0,00 inventada no banco
 * (`amountCents < 0 ? 'expense' : 'income'` mandava o zero para `income` em silêncio).
 */
export function kindForAmount(amountCents: Cents): Extract<TransactionKind, 'expense' | 'income'> {
  if (amountCents === 0) {
    throw new RangeError(
      'Valor zero não vira lançamento: é linha informativa e fica fora do que se importa (decisão 8).',
    );
  }
  return amountCents < 0 ? 'expense' : 'income';
}
