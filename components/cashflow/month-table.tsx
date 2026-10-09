import { Money } from '@/components/ui-kit';
import type { MonthComposition } from '@/app/_lib/to-cashflow-input';
import type { Competence } from '@/lib/date';
import type { CashflowMonth } from '@/lib/finance/cashflow';
import { cents, type Cents } from '@/lib/money';
import { cn } from '@/lib/utils';

import { competenceShort } from './labels';

type MonthTableProps = {
  months: readonly CashflowMonth[];
  composition: Readonly<Record<Competence, MonthComposition>>;
  /** Soma dos ajustes do "e se" por mês; `null` = sem simulação (coluna some). */
  adjustments: Readonly<Record<Competence, Cents>> | null;
};

/**
 * Tabela mês a mês. Cada número vem pronto do motor; aqui só se escolhe a cor.
 *
 *  - FECHAMENTO é a única coluna que fica vermelha, e pelo `negative` do motor
 *    (`closingCents < 0`). A linha inteira ganha o selo "Saldo negativo", porque
 *    cor sozinha não basta.
 *  - RESULTADO DO MÊS (`netCents`) é neutro de propósito: sai mais do que entra
 *    sem que o saldo tenha acabado. Pintá-lo de vermelho faria a família achar que
 *    quebrou. O `Money` pinta todo valor < 0 de vermelho; o `text-foreground`
 *    passado em `className` o anula.
 *  - "Faturas" é a fatura que VENCE no mês (RC-05), com a parte de parcelas
 *    detalhada por baixo. A parcela está DENTRO da fatura, não ao lado dela.
 */
export function MonthTable({ months, composition, adjustments }: MonthTableProps) {
  const zero = cents(0);
  return (
    <>
      {/* Desktop */}
      <div className="hidden md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Projeção de caixa mês a mês</caption>
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-2 py-2 text-left font-medium">Mês</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Abertura</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Receitas</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Despesas</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Parcelas</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Faturas</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Aportes</th>
              {adjustments ? (
                <th scope="col" className="px-2 py-2 text-right font-medium">Ajuste</th>
              ) : null}
              <th
                scope="col"
                className="px-2 py-2 text-right font-medium"
                title="Receitas menos todas as saídas do mês. Negativo aqui não quer dizer saldo negativo."
              >
                Resultado do mês
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Fechamento</th>
            </tr>
          </thead>
          <tbody>
            {months.map((month) => {
              const part = composition[month.competence];
              return (
                <tr
                  key={month.competence}
                  className={cn('border-b border-border last:border-0', month.negative && 'bg-red-50')}
                >
                  <th scope="row" className="whitespace-nowrap px-2 py-2 text-left font-medium">
                    {competenceShort(month.competence)}
                    {month.negative ? (
                      <span className="ml-2 inline-flex items-center border border-destructive/50 bg-destructive-soft px-2 py-0.5 text-xs font-medium text-destructive">
                        Saldo negativo
                      </span>
                    ) : null}
                  </th>
                  <td className="px-2 py-2 text-right"><Money value={month.openingCents} /></td>
                  <td className="px-2 py-2 text-right"><Money value={month.incomeCents} /></td>
                  <td className="px-2 py-2 text-right"><Money value={month.expenseCents} className="text-foreground" /></td>
                  <td className="px-2 py-2 text-right"><Money value={month.installmentsCents} className="text-foreground" /></td>
                  <td className="px-2 py-2 text-right">
                    <Money value={month.statementsCents} className="text-foreground" />
                    {part && part.statementInstallmentsCents > 0 ? (
                      <span className="block text-xs text-muted-foreground">
                        parcelas: <Money value={part.statementInstallmentsCents} className="text-muted-foreground" />
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-right"><Money value={month.contributionsCents} className="text-foreground" /></td>
                  {adjustments ? (
                    <td className="px-2 py-2 text-right">
                      <Money value={adjustments[month.competence] ?? zero} sign="always" className="text-foreground" />
                    </td>
                  ) : null}
                  <td className="px-2 py-2 text-right">
                    <Money value={month.netCents} sign="always" className="text-foreground" />
                  </td>
                  <td className="px-2 py-2 text-right font-semibold">
                    <Money value={month.closingCents} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Celular (390px): um cartão por mês; o detalhe fica atrás do <details>. */}
      <ul className="flex flex-col gap-2 md:hidden">
        {months.map((month) => {
          const part = composition[month.competence];
          return (
            <li
              key={month.competence}
              className={cn('border border-border p-3', month.negative && 'border-red-300 bg-red-50')}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">
                  {competenceShort(month.competence)}
                  {month.negative ? (
                    <span className="ml-2 inline-flex items-center border border-destructive/50 bg-destructive-soft px-2 py-0.5 text-xs font-medium text-destructive">
                      Saldo negativo
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground">fechamento</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  resultado do mês{' '}
                  <Money value={month.netCents} sign="always" className="text-foreground" />
                </span>
                <span className="text-base font-semibold"><Money value={month.closingCents} /></span>
              </div>
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-xs text-muted-foreground">Detalhe do mês</summary>
                <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">Abertura</dt>
                  <dd className="text-right"><Money value={month.openingCents} /></dd>
                  <dt className="text-muted-foreground">Receitas</dt>
                  <dd className="text-right"><Money value={month.incomeCents} /></dd>
                  <dt className="text-muted-foreground">Despesas</dt>
                  <dd className="text-right"><Money value={month.expenseCents} className="text-foreground" /></dd>
                  <dt className="text-muted-foreground">Parcelas</dt>
                  <dd className="text-right"><Money value={month.installmentsCents} className="text-foreground" /></dd>
                  <dt className="text-muted-foreground">Faturas</dt>
                  <dd className="text-right"><Money value={month.statementsCents} className="text-foreground" /></dd>
                  {part && part.statementInstallmentsCents > 0 ? (
                    <>
                      <dt className="pl-3 text-xs text-muted-foreground">das quais parcelas</dt>
                      <dd className="text-right text-xs"><Money value={part.statementInstallmentsCents} className="text-muted-foreground" /></dd>
                    </>
                  ) : null}
                  <dt className="text-muted-foreground">Aportes</dt>
                  <dd className="text-right"><Money value={month.contributionsCents} className="text-foreground" /></dd>
                  {adjustments ? (
                    <>
                      <dt className="text-muted-foreground">Ajuste (simulação)</dt>
                      <dd className="text-right"><Money value={adjustments[month.competence] ?? zero} sign="always" className="text-foreground" /></dd>
                    </>
                  ) : null}
                </dl>
              </details>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 max-w-prose text-xs text-muted-foreground">
        Vermelho = saldo no <strong className="font-medium">fim do mês</strong> abaixo de zero.
        &ldquo;Resultado do mês&rdquo; negativo só diz que saiu mais do que entrou naquele mês; o
        saldo pode continuar positivo. A fatura entra no mês em que vence, e as parcelas de cartão
        estão dentro dela.
      </p>
    </>
  );
}
