import { Canhoto, Money, Selo } from '@/components/ui-kit';
import type { MonthComposition } from '@/app/_lib/to-cashflow-input';
import type { Competence } from '@/lib/date';
import type { CashflowMonth } from '@/lib/finance/cashflow';
import { cents, type Cents } from '@/lib/money';

import { competenceLong, competenceMonth } from './labels';

type MonthTableProps = {
  months: readonly CashflowMonth[];
  composition: Readonly<Record<Competence, MonthComposition>>;
  /** Soma dos ajustes do "e se" por mês; `null` = sem simulação (linha some). */
  adjustments: Readonly<Record<Competence, Cents>> | null;
};

/** Talão do mês: o mês abreviado e o ano em duas linhas, sem barra (não é parcela nem data). */
function MonthStub({ competence }: { competence: Competence }) {
  return (
    <span className="flex flex-col items-center leading-tight">
      <span>{competenceMonth(competence)}</span>
      <span className="text-xs font-normal text-muted-foreground">{competence.slice(0, 4)}</span>
    </span>
  );
}

/**
 * Os 12 meses como um carnê: uma coluna de canhotos. O MÊS vai no talão, o saldo de FECHAMENTO é o valor
 * (a decisão da linha), e entradas e saídas ficam no corpo. Meses futuros que já têm compromisso
 * (fatura ou parcela) são canhotos PRESOS, tracejados: o futuro comprometido. Cada número vem pronto do
 * motor; aqui só se escolhe o que mostrar.
 *
 *  - Saldo negativo no FIM do mês (`negative` do motor) ganha o Selo com letra, não só cor.
 *  - "Resultado do mês" é neutro de propósito: sai mais do que entra sem que o saldo tenha acabado.
 *  - "Faturas" é a fatura que VENCE no mês, com a parte de parcelas dentro dela (não ao lado).
 */
export function MonthTable({ months, composition, adjustments }: MonthTableProps) {
  const zero = cents(0);
  return (
    <>
      <p className="text-right text-xs font-medium text-muted-foreground">Saldo no fim do mês</p>
      <ol className="flex flex-col gap-1.5" aria-label="Projeção de caixa mês a mês">
        {months.map((month, position) => {
          const part = composition[month.competence];
          const outflows = (month.expenseCents + month.installmentsCents + month.statementsCents + month.contributionsCents) as Cents;
          // Preso = mês futuro que já carrega compromisso de cartão; o mês corrente é o canhoto atual.
          const preso = position > 0 && (month.statementsCents !== 0 || month.installmentsCents !== 0);
          // Três tratamentos: atual (sólido), futuro comprometido (preso, tracejado) e futuro sem nada comprometido
          // (mudo: sem caixa nem borda, que é o que só o canhoto quitado/atual tem).
          const mudo = position > 0 && !preso;
          return (
            <Canhoto
              as="li"
              key={month.competence}
              ariaLabel={`${competenceLong(month.competence)}: fechamento`}
              stub={<MonthStub competence={month.competence} />}
              preso={preso}
              className={mudo ? 'border-transparent bg-transparent text-muted-foreground' : undefined}
              destaque={month.negative ? 'danger' : undefined}
              marcas={month.negative ? [{ label: 'Saldo negativo', tone: 'danger' }] : undefined}
              valor={<Money value={month.closingCents} className="font-semibold" />}
            >
              <p className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-sm">
                <span>
                  <span className="text-muted-foreground">Entradas </span>
                  <Money value={month.incomeCents} className="text-foreground" />
                </span>
                <span>
                  <span className="text-muted-foreground">Saídas </span>
                  <Money value={outflows} className="text-foreground" />
                </span>
              </p>
              <details className="text-sm">
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs text-muted-foreground sm:min-h-0">
                  Detalhe do mês
                </summary>
                <dl className="mt-1 grid max-w-sm grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">Abertura</dt>
                  <dd className="text-right"><Money value={month.openingCents} /></dd>
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
                  <dt className="text-muted-foreground" title="Receitas menos todas as saídas do mês. Negativo aqui não quer dizer saldo negativo.">
                    Resultado do mês
                  </dt>
                  <dd className="text-right"><Money value={month.netCents} sign="always" className="text-foreground" /></dd>
                </dl>
              </details>
            </Canhoto>
          );
        })}
      </ol>

      <div className="mt-3 flex max-w-prose flex-col gap-1.5 text-xs text-muted-foreground">
        <p className="flex flex-wrap items-center gap-2">
          <Selo tone="danger" label="Saldo negativo" />
          <span>saldo no <strong className="font-medium">fim do mês</strong> abaixo de zero.</span>
        </p>
        <p className="flex flex-wrap items-center gap-2">
          <span className="inline-block h-4 w-8 border border-dashed border-input" aria-hidden="true" />
          <span>canhoto tracejado: mês futuro que já carrega fatura ou parcela de cartão. Sem caixa: mês futuro sem nada comprometido.</span>
        </p>
        <p>
          &ldquo;Entradas&rdquo; e &ldquo;Saídas&rdquo; mostram o mês; saída maior que entrada não
          quer dizer saldo negativo. A fatura entra no mês em que vence, e as parcelas de cartão
          estão dentro dela.
        </p>
      </div>
    </>
  );
}
