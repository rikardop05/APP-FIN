import { LineChart } from 'lucide-react';

import { todayInSaoPaulo } from '@/app/_lib/today';
import { FluxoScreen } from '@/components/cashflow/fluxo-screen';
import { EmptyState, PageHeader } from '@/components/ui-kit';
import { requireSession } from '@/lib/auth/session';
import { getCashflowData } from '@/lib/db/queries/cashflow';
import { projectCashflow } from '@/lib/finance/cashflow';

import { toCashflowInput } from './_lib/to-cashflow-input';

export const dynamic = 'force-dynamic';

const WINDOW_MONTHS = 12;

/**
 * Tela de fluxo de caixa (T-207). SÓ LEITURA: lê o banco, monta a entrada do
 * motor e o roda; não grava nada e não chama `topUpPlanned` (que escreve). Se a
 * previsão de recorrência acabar antes dos 12 meses, a tela avisa em vez de
 * completá-la sozinha.
 *
 * Nenhuma conta de dinheiro aqui: o saldo e os totais saem de `projectCashflow`
 * (CONTRACTS §11). O adaptador só decide em que balde cada linha cai.
 */
export default async function FluxoPage() {
  const { householdId } = await requireSession();
  const today = todayInSaoPaulo();

  const data = await getCashflowData(householdId, today, WINDOW_MONTHS);
  const base = toCashflowInput(data);
  // Roda no servidor primeiro: sinal errado lança aqui, nunca vira gráfico torto.
  const projection = projectCashflow(base.input);

  const hasAnything =
    base.input.openingBalanceCents !== 0 ||
    base.input.incomes.length +
      base.input.recurringExpenses.length +
      base.input.installments.length +
      base.input.statementsDue.length +
      base.input.plannedContributions.length >
      0;

  return (
    <>
      <PageHeader
        title="Fluxo de caixa"
        description='Projeção do saldo para os próximos 12 meses e simulador "e se", sem gravar nada.'
      />
      {hasAnything ? (
        <FluxoScreen
          input={base.input}
          projection={projection}
          composition={base.composition}
          warnings={base.warnings}
        />
      ) : (
        <EmptyState
          icon={LineChart}
          title="Projeção ainda não disponível"
          description="A projeção depende de saldo em conta, despesas recorrentes, receitas e faturas cadastradas."
          action={{ label: 'Ver lançamentos', href: '/lancamentos' }}
        />
      )}
    </>
  );
}
