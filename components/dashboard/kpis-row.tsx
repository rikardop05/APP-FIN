import { ArrowDownRight, ArrowUpRight, PiggyBank, Receipt, Sparkles, TrendingDown, TrendingUp, Wallet } from 'lucide-react';

import { Money } from '@/components/ui-kit';
import { basisPoints, type BasisPoints, type Cents } from '@/lib/money';

type KpisRowProps = {
  incomeCents: Cents;
  expenseCents: Cents;
  contributionsCents: Cents;
  surplusCents: Cents;
  savingsRateBp: BasisPoints | null;
  essentialShareBp: BasisPoints | null;
  futureInstallmentsCents: Cents;
  uncategorizedCount: number;
  competence: string;
  /** Horizonte do comprometimento em meses — vem de `household_settings`. */
  commitmentMonths: number;
};

/**
 * Faixa 1 do dashboard (SPEC §5.8, linha 1) — KPIs do mês corrente.
 *
 * Cada número exibido vem do motor `monthlyKpis` (CONTRACTS §14). Esta tela
 * só reempacota — nada aqui é calculado:
 * - `incomeCents`, `expenseCents`, `contributionsCents`, `surplusCents` saem
 *   do motor com o sinal já tratado (líquido com piso em zero, decisão
 *   fixada em 2026-09-17);
 * - `savingsRateBp` e `essentialShareBp` chegam em basis points; a
 *   conversão para percentual é apresentação;
 * - `futureInstallmentsCents` é o input que o motor recebe, já somado no
 *   `lib/db/queries/dashboard.ts`.
 *
 * RC-03/RC-04: transferência e pagamento de fatura não aparecem aqui porque
 * o motor já os exclui. Aporte vai em "Aportes", não em despesa.
 */
export function KpisRow({
  incomeCents,
  expenseCents,
  contributionsCents,
  surplusCents,
  savingsRateBp,
  essentialShareBp,
  futureInstallmentsCents,
  uncategorizedCount,
  competence,
  commitmentMonths,
}: KpisRowProps) {
  const competenciaCurta = `${competence.slice(5)}/${competence.slice(0, 4)}`;
  const surplusIsDeficit = surplusCents < 0;
  return (
    <section
      aria-labelledby="dashboard-kpis-heading"
      className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
    >
      <div className="mb-4">
        <h2 id="dashboard-kpis-heading" className="text-base font-semibold text-foreground">
          Resumo do mês
        </h2>
        <p className="text-sm text-muted-foreground">
          Competência {competenciaCurta}. Aporte é separado de despesa.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          label="Receita do mês"
          icon={ArrowUpRight}
          tone="positive"
        >
          <Money value={incomeCents} sign="never" />
        </KpiCard>
        <KpiCard
          label="Despesa do mês"
          icon={ArrowDownRight}
          tone="negative"
        >
          <Money value={expenseCents} sign="never" />
        </KpiCard>
        <KpiCard
          label={surplusIsDeficit ? 'Déficit do mês' : 'Sobra do mês'}
          icon={surplusIsDeficit ? TrendingDown : TrendingUp}
          tone={surplusIsDeficit ? 'negative' : 'neutral'}
        >
          <Money value={surplusCents} />
        </KpiCard>
        <KpiCard
          label="Taxa de poupança"
          icon={PiggyBank}
          tone="neutral"
          hint={savingsRateBp === null ? 'sem renda no mês' : undefined}
        >
          {savingsRateBp === null ? '—' : <span className="tabular">{formatBasisPoints(savingsRateBp)}</span>}
        </KpiCard>
        <KpiCard
          label="Essenciais / renda"
          icon={Wallet}
          tone="neutral"
          hint={essentialShareBp === null ? 'sem renda no mês' : undefined}
        >
          {essentialShareBp === null ? '—' : <span className="tabular">{formatBasisPoints(essentialShareBp)}</span>}
        </KpiCard>
        <KpiCard
          label="Aportes"
          icon={Sparkles}
          tone="neutral"
          hint="Patrimônio, não consumo"
        >
          <Money value={contributionsCents} sign="never" />
        </KpiCard>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <KpiCard
          label={`Parcelas a vencer (${commitmentMonths} m)`}
          icon={Receipt}
          tone="neutral"
          hint={`Soma das parcelas planejadas nos próximos ${commitmentMonths} meses (mesma janela do card de comprometimento).`}
        >
          <Money value={futureInstallmentsCents} sign="never" />
        </KpiCard>
        <KpiCard
          label="Não categorizados"
          icon={Receipt}
          tone={uncategorizedCount > 0 ? 'warning' : 'neutral'}
          hint={
            uncategorizedCount === 0
              ? 'Tudo classificado neste mês.'
              : 'Lançamentos do mês sem categoria — fila de pendências.'
          }
        >
          <span className="tabular">{uncategorizedCount}</span>
        </KpiCard>
      </div>
    </section>
  );
}

type Tone = 'positive' | 'negative' | 'neutral' | 'warning';

function toneClasses(tone: Tone): { icon: string } {
  switch (tone) {
    case 'positive':
      return { icon: 'text-emerald-700' };
    case 'negative':
      return { icon: 'text-red-700' };
    case 'warning':
      return { icon: 'text-amber-700' };
    case 'neutral':
    default:
      return { icon: 'text-muted-foreground' };
  }
}

function KpiCard({
  label,
  icon: Icon,
  tone,
  hint,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  hint?: string;
  children: React.ReactNode;
}) {
  const classes = toneClasses(tone);
  return (
    <article className="flex flex-col gap-1 rounded-lg border border-border bg-background p-3">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 shrink-0 ${classes.icon}`} aria-hidden={true} />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="text-lg font-semibold text-foreground">{children}</div>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </article>
  );
}

/**
 * `basisPoints` em percentual pt-BR. Apresentação apenas — a regra (RC-03,
 * RC-04, sinal com piso) está em `monthlyKpis`. Recebe o `BasisPoints` do
 * motor e devolve string "X,YY%".
 */
function formatBasisPoints(value: BasisPoints): string {
  const bp = basisPoints(value);
  const whole = Math.floor(bp / 100);
  const fraction = Math.abs(bp % 100);
  return `${whole},${String(fraction).padStart(2, '0')}%`;
}
