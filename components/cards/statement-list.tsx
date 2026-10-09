import Link from 'next/link';
import { competenceShort } from '@/components/cashflow/labels';
import { Badge, Canhoto, Carimbo, DateText, EmptyState, Money } from '@/components/ui-kit';
import type { IsoDate } from '@/lib/date';
import type { CardCycleConfig } from '@/lib/finance/billing';
import { dueDateWarnings } from './due-date-check';
import type { StatementRecord } from './schemas';
import { isOverdueUnpaid, OVERDUE_UNPAID_HINT } from './statement-paid';
import { StatementPaidButton } from './statement-paid-button';

/**
 * A lista só mostra. Gravar a marca de paga é do `StatementPaidButton` (que fala com a rota do Funil);
 * a lista nunca faz `fetch`, e o aviso de vencimento continua sendo só aviso.
 */
const statusLabel: Record<StatementRecord['status'], string> = {
  open: 'Aberta',
  closed: 'Fechada',
  paid: 'Paga',
};

const statusVariant: Record<StatementRecord['status'], 'neutral' | 'success' | 'warning'> = {
  open: 'warning',
  closed: 'neutral',
  paid: 'success',
};

type StatementListProps = {
  statements: StatementRecord[];
  /** Ciclo ATUAL do cartão (fecha/vence): base do aviso de vencimento desatualizado (decisão 11c). */
  cycle?: CardCycleConfig;
  /** Hoje (`YYYY-MM-DD`): o aviso só vale para fatura que ainda não venceu. */
  today: IsoDate;
  /** Depois de marcar ou desmarcar como paga: a tela recarrega as faturas. */
  onStatusChanged?: () => void;
};

export function StatementList({ statements, cycle, today, onStatusChanged }: StatementListProps) {
  const changed = onStatusChanged ?? (() => undefined);
  const warnings = cycle === undefined ? [] : dueDateWarnings(statements, cycle, today);
  const staleIds = new Set(warnings.map((warning) => warning.statementId));

  if (statements.length === 0) {
    return (
      <EmptyState
        title="Nenhuma fatura cadastrada"
        description="Importe uma fatura para conferir o total calculado e o total informado."
        action={{ label: 'Importar fatura', href: '/importar' }}
        className="px-4 py-8"
      />
    );
  }

  return (
    <>
      {warnings.length > 0 ? (
        <div className="mb-3 border border-warning/50 bg-warning-soft px-3 py-2 text-sm text-warning" role="status">
          <p className="font-medium">Vencimento diferente do ciclo atual do cartão</p>
          <ul className="mt-1 flex flex-col gap-1">
            {warnings.map((warning) => (
              <li key={warning.statementId}>{warning.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Competência</th>
              <th className="px-3 py-2 font-medium">Vencimento</th>
              <th className="px-3 py-2 text-right font-medium">Calculado</th>
              <th className="px-3 py-2 text-right font-medium">Informado</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Ação</th>
            </tr>
          </thead>
          <tbody>
            {statements.map((statement) => (
              <StatementTableRow key={statement.id} statement={statement} staleDueDate={staleIds.has(statement.id)} overdue={isOverdueUnpaid(statement, today)} onChanged={changed} />
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-2 md:hidden">
        {statements.map((statement) => (
          <StatementCard key={statement.id} statement={statement} staleDueDate={staleIds.has(statement.id)} overdue={isOverdueUnpaid(statement, today)} onChanged={changed} />
        ))}
      </ul>
    </>
  );
}

function StatementTableRow({ statement, staleDueDate, overdue, onChanged }: { statement: StatementRecord; staleDueDate: boolean; overdue: boolean; onChanged: () => void }) {
  const mismatch = statement.differenceCents !== null && statement.differenceCents !== 0;

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-3 align-middle font-medium">{competenceShort(statement.period)}</td>
      <td className="px-3 py-3 align-middle"><DateText value={statement.dueDate} /></td>
      <td className="px-3 py-3 text-right align-middle"><Money value={statement.computedTotalCents} /></td>
      <td className="px-3 py-3 text-right align-middle">
        {statement.reportedTotalCents === null ? '—' : <Money value={statement.reportedTotalCents} />}
      </td>
      <td className="px-3 py-3 align-middle">
        <div className="flex flex-wrap items-center gap-2">
          <StatusMark status={statement.status} />
          {mismatch ? <Badge variant="danger">Divergência</Badge> : null}
          {overdue ? <Badge variant="warning" title={OVERDUE_UNPAID_HINT}>Vencida, não marcada como paga</Badge> : null}
          {staleDueDate ? <Badge variant="warning">Vencimento desatualizado</Badge> : null}
        </div>
      </td>
      <td className="px-3 py-3 align-middle">
        <StatementPaidButton statement={statement} onChanged={onChanged} />
      </td>
    </tr>
  );
}

/** PAGO é carimbo; os demais estados seguem como etiqueta. */
function StatusMark({ status }: { status: StatementRecord['status'] }) {
  return status === 'paid' ? (
    <Carimbo tone="ok">Pago</Carimbo>
  ) : (
    <Badge variant={statusVariant[status]}>{statusLabel[status]}</Badge>
  );
}

function StatementCard({ statement, staleDueDate, overdue, onChanged }: { statement: StatementRecord; staleDueDate: boolean; overdue: boolean; onChanged: () => void }) {
  const mismatch = statement.differenceCents !== null && statement.differenceCents !== 0;

  return (
    <Canhoto
      as="li"
      stub={competenceShort(statement.period)}
      valor={<Money value={statement.computedTotalCents} />}
    >
      <p className="text-sm text-muted-foreground">
        Vencimento <DateText value={statement.dueDate} />
        {statement.reportedTotalCents === null ? null : (
          <>
            {' '}· informado <Money value={statement.reportedTotalCents} />
          </>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <StatusMark status={statement.status} />
        {mismatch ? <Badge variant="danger">Divergência</Badge> : null}
          {overdue ? <Badge variant="warning" title={OVERDUE_UNPAID_HINT}>Vencida, não marcada como paga</Badge> : null}
        {staleDueDate ? <Badge variant="warning">Vencimento desatualizado</Badge> : null}
      </div>
      {mismatch ? (
        <p className="text-sm text-destructive">
          Diferença da conciliação:{' '}
          {statement.differenceCents === null ? null : <Money value={statement.differenceCents} />}
        </p>
      ) : null}
      <StatementPaidButton statement={statement} onChanged={onChanged} />
      <Link href="/importar" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 sm:min-h-0">
        Ver importação
      </Link>
    </Canhoto>
  );
}
