import Link from 'next/link';
import { Badge, DateText, EmptyState, Money } from '@/components/ui-kit';
import type { StatementRecord } from './schemas';

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
};

export function StatementList({ statements }: StatementListProps) {
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
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Competência</th>
              <th className="px-3 py-2 font-medium">Vencimento</th>
              <th className="px-3 py-2 text-right font-medium">Calculado</th>
              <th className="px-3 py-2 text-right font-medium">Informado</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {statements.map((statement) => (
              <StatementTableRow key={statement.id} statement={statement} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2 md:hidden">
        {statements.map((statement) => (
          <StatementCard key={statement.id} statement={statement} />
        ))}
      </div>
    </>
  );
}

function StatementTableRow({ statement }: { statement: StatementRecord }) {
  const mismatch = statement.differenceCents !== null && statement.differenceCents !== 0;

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-3 align-middle font-medium">{statement.period}</td>
      <td className="px-3 py-3 align-middle"><DateText value={statement.dueDate} /></td>
      <td className="px-3 py-3 text-right align-middle"><Money value={statement.computedTotalCents} /></td>
      <td className="px-3 py-3 text-right align-middle">
        {statement.reportedTotalCents === null ? '—' : <Money value={statement.reportedTotalCents} />}
      </td>
      <td className="px-3 py-3 align-middle">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariant[statement.status]}>{statusLabel[statement.status]}</Badge>
          {mismatch ? <Badge variant="danger">Divergência</Badge> : null}
        </div>
      </td>
    </tr>
  );
}

function StatementCard({ statement }: { statement: StatementRecord }) {
  const mismatch = statement.differenceCents !== null && statement.differenceCents !== 0;

  return (
    <article className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-medium text-foreground">Competência {statement.period}</h4>
          <p className="text-xs text-muted-foreground">
            Vencimento <DateText value={statement.dueDate} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={statusVariant[statement.status]}>{statusLabel[statement.status]}</Badge>
          {mismatch ? <Badge variant="danger">Divergência</Badge> : null}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Total calculado</dt>
          <dd className="font-medium"><Money value={statement.computedTotalCents} /></dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Total informado</dt>
          <dd className="font-medium">
            {statement.reportedTotalCents === null ? '—' : <Money value={statement.reportedTotalCents} />}
          </dd>
        </div>
      </dl>
      {mismatch ? (
        <p className="mt-3 text-xs text-destructive">
          Diferença da conciliação:{' '}
          {statement.differenceCents === null ? null : <Money value={statement.differenceCents} />}
        </p>
      ) : null}
      <Link href="/importar" className="mt-3 inline-flex text-xs font-medium text-primary underline-offset-4 hover:underline">
        Ver importação
      </Link>
    </article>
  );
}
