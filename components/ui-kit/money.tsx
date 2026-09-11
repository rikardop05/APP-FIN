import { formatBRL, type Cents } from '@/lib/money';
import { cn } from '@/lib/utils';

type MoneyProps = {
  /** Valor em centavos. Nunca `number` decimal — CONVENTIONS §2. */
  value: Cents;
  /**
   * Ver `formatBRL`: `'auto'` mostra o `-` do negativo, `'always'` prefixa `+`
   * no positivo. `'never'` remove o `-` E a cor de destaque — os dois
   * indicadores de direção somem juntos. Use `'never'` só quando a direção já
   * vem de outro elemento (cabeçalho da coluna, ícone); numa coluna com
   * despesa e receita misturadas, `'never'` as deixa visualmente idênticas.
   */
  sign?: 'auto' | 'never' | 'always';
  className?: string;
};

/**
 * Único componente autorizado a exibir valor monetário (CONVENTIONS §2).
 * Formata via `formatBRL`, nunca `toFixed`, `toLocaleString` ou `R$` direto
 * no JSX — se precisar formatar dinheiro em outro lugar, é sinal de que falta
 * passar o valor por aqui, não de escrever a conta de novo.
 */
export function Money({ value, sign = 'auto', className }: MoneyProps) {
  const negative = value < 0;

  return (
    <span
      className={cn(
        'tabular',
        negative && sign !== 'never' && 'text-destructive',
        className,
      )}
    >
      {formatBRL(value, { sign })}
    </span>
  );
}
