import { AlertTriangle, ShieldCheck } from 'lucide-react';

import { Money } from '@/components/ui-kit';
import type { CashflowProjection } from '@/lib/finance/cashflow';
import { cn } from '@/lib/utils';

import { competenceLong, competenceShort } from './labels';

type VerdictProps = {
  projection: CashflowProjection;
  /** Projeção sem os ajustes do "e se"; só presente quando há simulação ativa. */
  baseProjection: CashflowProjection | null;
};

/**
 * "Quando eu quebro?" — o número mais importante da tela. Vem direto de
 * `firstNegativeCompetence` (primeiro mês com FECHAMENTO negativo, não com
 * resultado negativo).
 *
 * `null` é uma resposta, e é dita com todas as letras — mas sempre acompanhada
 * da ressalva fixa abaixo: o motor só enxerga compromisso conhecido, então
 * "não fica negativo" quer dizer "não fica negativo COM O QUE ESTÁ CADASTRADO".
 * Um app que diz "você está bem" tendo olhado metade da despesa é pior que um
 * que não diz nada.
 */
export function Verdict({ projection, baseProjection }: VerdictProps) {
  const first = projection.firstNegativeCompetence;
  const firstMonth =
    first === null ? undefined : projection.months.find((month) => month.competence === first);
  const worst =
    projection.minClosingCents === null
      ? undefined
      : projection.months.find((month) => month.closingCents === projection.minClosingCents);

  return (
    <section
      aria-labelledby="fluxo-verdict-heading"
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-4 shadow-sm sm:p-5',
        first === null ? 'border-border bg-card' : 'border-red-300 bg-red-50',
      )}
    >
      <div className="flex items-start gap-3">
        {first === null ? (
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" aria-hidden="true" />
        ) : (
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-red-700" aria-hidden="true" />
        )}
        <div className="flex flex-col gap-1">
          <h2
            id="fluxo-verdict-heading"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Quando o saldo fica negativo?
          </h2>
          {first === null ? (
            <p className="text-lg font-semibold text-foreground sm:text-xl">
              Com os compromissos cadastrados, o saldo não fica negativo nos próximos{' '}
              {projection.months.length} meses.
            </p>
          ) : (
            <p className="text-lg font-semibold text-red-900 sm:text-xl">
              O saldo fica negativo em {competenceLong(first)}
              {firstMonth ? (
                <>
                  , fechando o mês em <Money value={firstMonth.closingCents} />
                </>
              ) : null}
              .
            </p>
          )}
          {worst ? (
            <p className="text-sm text-muted-foreground">
              Pior fechamento da janela: <Money value={worst.closingCents} /> em{' '}
              {competenceShort(worst.competence)}.
            </p>
          ) : null}
          {baseProjection ? (
            <p className="text-sm text-muted-foreground">
              Sem a simulação:{' '}
              {baseProjection.firstNegativeCompetence === null
                ? 'o saldo não fica negativo na janela.'
                : `o saldo fica negativo em ${competenceLong(baseProjection.firstNegativeCompetence)}.`}
            </p>
          ) : null}
        </div>
      </div>

      <p className="border-t border-border pt-3 text-sm text-muted-foreground">
        <strong className="font-medium text-foreground">Esta projeção é otimista por construção.</strong>{' '}
        Ela só enxerga o que já está cadastrado: receitas, despesas fixas, parcelas e faturas.
        Gastos variáveis dos meses futuros — mercado, lazer, combustível — não entram. Então
        &ldquo;não fica negativo&rdquo; quer dizer &ldquo;não fica negativo com os compromissos
        conhecidos&rdquo;, e o saldo real tende a ficar abaixo da curva.
      </p>
    </section>
  );
}
