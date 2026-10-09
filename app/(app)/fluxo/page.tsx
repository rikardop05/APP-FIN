import { LineChart } from 'lucide-react';

import { loadProjectedCashflow } from '@/app/_lib/load-cashflow';
import { todayInSaoPaulo } from '@/app/_lib/today';
import { FluxoScreen } from '@/components/cashflow/fluxo-screen';
import { EmptyState, PageHeader } from '@/components/ui-kit';
import { requireSession } from '@/lib/auth/session';
import { cents } from '@/lib/money';

export const dynamic = 'force-dynamic';

/**
 * Tela de fluxo de caixa (T-207). Lê o banco, monta a entrada do motor e o roda,
 * tudo em `loadProjectedCashflow` — o mesmo caminho do painel. Essa função completa
 * a previsão de recorrência (`topUpPlanned`, escrita idempotente) antes de ler, como
 * o painel já fazia; a tela em si não grava nada.
 *
 * Nenhuma conta de dinheiro aqui: o saldo e os totais saem de `projectCashflow`
 * (CONTRACTS §11). O adaptador só decide em que balde cada linha cai.
 */
export default async function FluxoPage() {
  const { householdId } = await requireSession();
  const today = todayInSaoPaulo();

  // Mesmo caminho do painel (`loadProjectedCashflow`): é o que garante o mesmo saldo nas duas telas.
  const base = await loadProjectedCashflow(householdId, today);
  const projection = base.projection;

  return (
    <>
      <PageHeader
        title="Fluxo de caixa"
        description='Projeção do saldo para os próximos 12 meses e simulador "e se", sem gravar nada.'
      />
      {base.hasProjectableData ? (
        <FluxoScreen
          input={base.input}
          projection={projection}
          composition={base.composition}
          warnings={base.warnings}
          // A frase "sem contar R$ X" usa o que a projeção de fato NÃO leva (vencimento antes da janela ou sem
          // vencimento): `consideredCents` da segunda leitura, não o total do Comprometido.
          overdueUnpaidCents={cents(base.withOverdueStatements.consideredCents)}
          overdueUnpaidCompetences={base.overdueUnpaidStatements.competences}
          withOverdueStatements={base.withOverdueStatements}
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
