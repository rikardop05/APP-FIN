import { Canhoto, Money, Selo } from '@/components/ui-kit';
import type { MonthComposition } from '@/app/_lib/to-cashflow-input';
import type { Competence } from '@/lib/date';
import type { CashflowMonth } from '@/lib/finance/cashflow';
import type { Cents } from '@/lib/money';

import { competenceLong, competenceMonth, competenceShort } from './labels';

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
 *  - Um número aparece UMA vez por canhoto: rubrica zerada vira texto ("zerado no mês"), sem
 *    repetir o R$ 0,00; valor que já está no corpo (total) ou no talão (fechamento) é referenciado
 *    por extenso no detalhe, em vez de impresso de novo.
 *  - Mês futuro sem nada (sem entradas, sem saídas, sem ajuste e sem selo) não vira canhoto:
 *    meses vazios seguidos colapsam numa linha-sumário ("Sem movimento de mar/2027 a set/2027").
 */
export function MonthTable({ months, composition, adjustments }: MonthTableProps) {
  // Filetes de meses vazios: só o futuro colapsa (o mês corrente fica sempre à vista) e nunca
  // o mês com selo (o negativo precisa ser visto) nem o mês com ajuste da simulação.
  type Row =
    | { kind: 'month'; month: CashflowMonth; position: number }
    | { kind: 'gap'; from: Competence; to: Competence };
  const rows: Row[] = [];
  let gapFrom: Competence | null = null;
  let gapTo: Competence | null = null;
  // `for` simples (não `forEach`): as atribuições ficam no mesmo escopo e a análise de fluxo as enxerga.
  for (let position = 0; position < months.length; position += 1) {
    const month = months[position];
    if (month === undefined) continue;
    const outflows = (month.expenseCents + month.installmentsCents + month.statementsCents + month.contributionsCents) as Cents;
    const adjustment = adjustments?.[month.competence];
    const empty =
      position > 0 &&
      !month.negative &&
      month.incomeCents === 0 &&
      outflows === 0 &&
      (adjustment === undefined || adjustment === 0);
    if (empty) {
      if (gapFrom === null) gapFrom = month.competence;
      gapTo = month.competence;
    } else {
      if (gapFrom !== null && gapTo !== null) {
        rows.push({ kind: 'gap', from: gapFrom, to: gapTo });
        gapFrom = null;
        gapTo = null;
      }
      rows.push({ kind: 'month', month, position });
    }
  }
  if (gapFrom !== null && gapTo !== null) rows.push({ kind: 'gap', from: gapFrom, to: gapTo });

  // A legenda só mostra as formas que existem na página: sem mês negativo, sem selo vermelho.
  const hasNegative = months.some((month) => month.negative);
  const hasPreso = months.some(
    (month, position) =>
      position > 0 && (month.statementsCents !== 0 || month.installmentsCents !== 0),
  );
  return (
    <>
      <p className="text-right text-xs font-medium text-muted-foreground">Saldo no fim do mês</p>
      <ol className="flex flex-col gap-1.5" aria-label="Projeção de caixa mês a mês">
        {rows.map((row) => {
          if (row.kind === 'gap') {
            const key = `gap-${row.from}-${row.to}`;
            const text =
              row.from === row.to
                ? `Sem movimento em ${competenceShort(row.from)}.`
                : `Sem movimento de ${competenceShort(row.from)} a ${competenceShort(row.to)}.`;
            return (
              <li key={key} className="border border-dashed border-input px-3 py-2 text-sm text-muted-foreground">
                {text}
              </li>
            );
          }
          const { month, position } = row;
          const part = composition[month.competence];
          const outflows = (month.expenseCents + month.installmentsCents + month.statementsCents + month.contributionsCents) as Cents;
          // Preso = mês futuro que já carrega compromisso de cartão; o mês corrente é o canhoto atual.
          const preso = position > 0 && (month.statementsCents !== 0 || month.installmentsCents !== 0);
          // Três tratamentos: atual (sólido), futuro comprometido (preso, tracejado) e futuro sem nada comprometido
          // (mudo: sem caixa nem borda, que é o que só o canhoto quitado/atual tem).
          const mudo = position > 0 && !preso;
          // Detalhe sem repetir número: o corpo já mostra Entradas e Saídas e o
          // talão mostra o fechamento; o detalhe referencia esses valores por
          // extenso quando coincidem, e agrupa os zerados numa frase só.
          const noFlow = month.incomeCents === 0 && outflows === 0;
          const sameAsClose = month.openingCents === month.closingCents;
          const parts: Array<{ label: string; value: Cents }> = [
            { label: 'Despesas', value: month.expenseCents },
            { label: 'Parcelas', value: month.installmentsCents },
            { label: 'Faturas', value: month.statementsCents },
            { label: 'Aportes', value: month.contributionsCents },
          ];
          const adjustment = adjustments?.[month.competence];
          const zeroedLabels = [
            ...parts.filter((part) => part.value === 0).map((part) => part.label),
            ...(month.netCents === 0 ? ['resultado do mês'] : []),
            ...(adjustment === 0 ? ['ajuste (simulação)'] : []),
          ];
          const statementSplits =
            part !== undefined &&
            part.statementInstallmentsCents > 0 &&
            part.statementInstallmentsCents !== month.statementsCents;
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
                {noFlow ? (
                  <span className="text-muted-foreground">Sem entradas nem saídas neste mês.</span>
                ) : (
                  <>
                    {month.incomeCents === 0 ? (
                      <span className="text-muted-foreground">Sem entradas</span>
                    ) : (
                      <span>
                        <span className="text-muted-foreground">Entradas </span>
                        <Money value={month.incomeCents} className="text-foreground" />
                      </span>
                    )}
                    {outflows === 0 ? (
                      <span className="text-muted-foreground">Sem saídas</span>
                    ) : (
                      <span>
                        <span className="text-muted-foreground">Saídas </span>
                        <Money value={outflows} className="text-foreground" />
                      </span>
                    )}
                  </>
                )}
              </p>
              <details className="text-sm">
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs text-muted-foreground sm:min-h-0">
                  Detalhe do mês
                </summary>
                <dl className="mt-1 grid max-w-sm grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">Abertura</dt>
                  {sameAsClose ? (
                    <dd className="text-right text-xs text-muted-foreground">igual ao fechamento</dd>
                  ) : (
                    <dd className="text-right"><Money value={month.openingCents} /></dd>
                  )}
                  {parts.map((row) =>
                    row.value === 0 ? null : row.value === outflows ? (
                      <div key={row.label} className="contents">
                        <dt className="text-muted-foreground">{row.label}</dt>
                        <dd className="text-right text-xs text-muted-foreground">nas Saídas acima</dd>
                      </div>
                    ) : (
                      <div key={row.label} className="contents">
                        <dt className="text-muted-foreground">{row.label}</dt>
                        <dd className="text-right"><Money value={row.value} className="text-foreground" /></dd>
                      </div>
                    ),
                  )}
                  {part && part.statementInstallmentsCents > 0 ? (
                    statementSplits ? (
                      <>
                        <dt className="pl-3 text-xs text-muted-foreground">das quais parcelas</dt>
                        <dd className="text-right text-xs"><Money value={part.statementInstallmentsCents} className="text-muted-foreground" /></dd>
                      </>
                    ) : (
                      <>
                        <dt className="pl-3 text-xs text-muted-foreground">das quais parcelas</dt>
                        <dd className="text-right text-xs text-muted-foreground">toda a fatura acima</dd>
                      </>
                    )
                  ) : null}
                  {adjustment !== undefined && adjustment !== 0 ? (
                    <>
                      <dt className="text-muted-foreground">Ajuste (simulação)</dt>
                      <dd className="text-right"><Money value={adjustment} sign="always" className="text-foreground" /></dd>
                    </>
                  ) : null}
                  {month.netCents === 0 ? null : month.netCents === month.incomeCents && outflows === 0 ? (
                    <>
                      <dt className="text-muted-foreground" title="Receitas menos todas as saídas do mês. Negativo aqui não quer dizer saldo negativo.">
                        Resultado do mês
                      </dt>
                      <dd className="text-right text-xs text-muted-foreground">igual às Entradas acima</dd>
                    </>
                  ) : (
                    <>
                      <dt className="text-muted-foreground" title="Receitas menos todas as saídas do mês. Negativo aqui não quer dizer saldo negativo.">
                        Resultado do mês
                      </dt>
                      <dd className="text-right"><Money value={month.netCents} sign="always" className="text-foreground" /></dd>
                    </>
                  )}
                </dl>
                {zeroedLabels.length > 0 ? (
                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                    Zerado no mês: {zeroedLabels.join(', ').toLowerCase()}.
                  </p>
                ) : null}
              </details>
            </Canhoto>
          );
        })}
      </ol>

      <div className="mt-3 flex max-w-prose flex-col gap-1.5 text-xs text-muted-foreground">
        {hasNegative ? (
          <p className="flex flex-wrap items-center gap-2">
            <Selo tone="danger" label="Saldo negativo" />
            <span>saldo no <strong className="font-medium">fim do mês</strong> abaixo de zero.</span>
          </p>
        ) : null}
        {hasPreso ? (
          <p className="flex flex-wrap items-center gap-2">
            <span className="inline-block h-4 w-8 border border-dashed border-input" aria-hidden="true" />
            <span>canhoto tracejado: mês futuro que já carrega fatura ou parcela de cartão. Sem caixa: mês futuro sem nada comprometido.</span>
          </p>
        ) : null}
        <p>
          &ldquo;Entradas&rdquo; e &ldquo;Saídas&rdquo; mostram o mês; saída maior que entrada não
          quer dizer saldo negativo. A fatura entra no mês em que vence, e as parcelas de cartão
          estão dentro dela.
        </p>
      </div>
    </>
  );
}
