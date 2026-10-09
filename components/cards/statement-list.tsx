import Link from 'next/link';
import { competenceShort } from '@/components/cashflow/labels';
import { Canhoto, Carimbo, EmptyState, Money, Picote, dataTalao } from '@/components/ui-kit';
import type { SeloTone } from '@/components/ui-kit';
import type { Cents } from '@/lib/money';
import type { IsoDate } from '@/lib/date';
import type { CardCycleConfig } from '@/lib/finance/billing';
import type { FutureStub } from './card-stubs';
import { dueDateWarnings } from './due-date-check';
import type { StatementRecord } from './schemas';
import { isOverdueUnpaid, OVERDUE_UNPAID_HINT } from './statement-paid';
import { StatementPaidButton } from './statement-paid-button';

/**
 * As faturas do cartão como CANHOTOS (um por fatura, em qualquer largura). O talão é o VENCIMENTO, em
 * "20 jul" (sem ano: o ano está no texto "Fatura de jul/2026"); fatura não é parcela, então sem n/N.
 * Abaixo, os meses seguintes com fatura devedora ainda não gravada, como canhotos PRESOS (tracejados).
 *
 * A lista só mostra. Gravar a marca de paga é do `StatementPaidButton` (que fala com a rota do Funil);
 * a lista nunca faz `fetch`, e o aviso de vencimento continua sendo só aviso. A letra do selo é da
 * tabela central do ui-kit: aqui só vão rótulo e tom.
 */
const statusLabel: Record<StatementRecord['status'], string> = {
  open: 'Aberta',
  closed: 'Fechada',
  paid: 'Paga',
};

/** Canhoto dentro do card do cartão não vira caixa (card dentro de card): só a régua de cima. */
const FLAT = 'border-0 border-t border-border';
const FLAT_PRESO = 'border-0 border-t border-dashed border-input';

/** Quantos canhotos presos mostrar por cartão. */
const STUB_LIMIT = 4;

type Marca = { label: string; tone: SeloTone };

type StatementListProps = {
  statements: StatementRecord[];
  /** Ciclo ATUAL do cartão (fecha/vence): base do aviso de vencimento desatualizado (decisão 11c). */
  cycle?: CardCycleConfig;
  /** Hoje (`YYYY-MM-DD`): o aviso só vale para fatura que ainda não venceu. */
  today: IsoDate;
  /** Meses seguintes com fatura devedora ainda não gravada (`futureStubsForCard`). */
  futureStubs?: FutureStub[];
  /** Depois de marcar ou desmarcar como paga: a tela recarrega as faturas. */
  onStatusChanged?: () => void;
};

export function StatementList({ statements, cycle, today, futureStubs = [], onStatusChanged }: StatementListProps) {
  const changed = onStatusChanged ?? (() => undefined);
  const warnings = cycle === undefined ? [] : dueDateWarnings(statements, cycle, today);
  const staleIds = new Set(warnings.map((warning) => warning.statementId));

  if (statements.length === 0 && futureStubs.length === 0) {
    return (
      <EmptyState
        title="Nenhuma fatura cadastrada"
        description="Importe uma fatura para conferir o total calculado e o total informado."
        action={{ label: 'Importar fatura', href: '/importar' }}
        className="px-4 py-8"
      />
    );
  }

  const shownStubs = futureStubs.slice(0, STUB_LIMIT);
  const hiddenStubs = futureStubs.length - shownStubs.length;

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
      <ul className="flex flex-col" aria-label="Faturas">
        {statements.map((statement) => (
          <StatementCanhoto
            key={statement.id}
            statement={statement}
            staleDueDate={staleIds.has(statement.id)}
            overdue={isOverdueUnpaid(statement, today)}
            onChanged={changed}
          />
        ))}
      </ul>
      {shownStubs.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          <Picote />
          <h5 className="text-sm font-medium text-foreground">Ainda presos</h5>
          <ul className="flex flex-col" aria-label="Faturas dos próximos meses">
            {shownStubs.map((stub) => (
              <Canhoto
                as="li"
                key={stub.competence}
                preso
                className={FLAT_PRESO}
                stub={dataTalao(stub.dueDate)}
                valor={<Money value={-stub.totalCents as Cents} sign="never" />}
              >
                <span className="text-sm">
                  Fatura de {competenceShort(stub.competence)}
                  {stub.purchaseCents === 0 ? ' · parcelas' : ' · parcelas e compras'}
                </span>
              </Canhoto>
            ))}
          </ul>
          {hiddenStubs > 0 ? (
            <p className="text-sm text-muted-foreground">
              Mais {hiddenStubs} {hiddenStubs === 1 ? 'mês' : 'meses'} no Painel, em Comprometido nos cartões.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** UM estado de fatura por canhoto: paga (carimbo no corpo), vencida e não paga, ou o status gravado. */
function stateMarca(status: StatementRecord['status'], overdue: boolean): Marca | null {
  if (status === 'paid') return null;
  if (overdue) return { label: 'Vencida, não marcada como paga', tone: 'attention' };
  return { label: statusLabel[status], tone: 'neutral' };
}

function StatementCanhoto({
  statement,
  staleDueDate,
  overdue,
  onChanged,
}: {
  statement: StatementRecord;
  staleDueDate: boolean;
  overdue: boolean;
  onChanged: () => void;
}) {
  const mismatch = statement.differenceCents !== null && statement.differenceCents !== 0;
  const state = stateMarca(statement.status, overdue);
  const marcas: Marca[] = [];
  if (state) marcas.push(state);
  if (mismatch) marcas.push({ label: 'Divergência', tone: 'danger' });
  if (staleDueDate) marcas.push({ label: 'Vencimento desatualizado', tone: 'attention' });

  return (
    <Canhoto
      as="li"
      className={FLAT}
      stub={dataTalao(statement.dueDate)}
      marcas={marcas}
      valor={<Money value={statement.computedTotalCents} sign="never" />}
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium">Fatura de {competenceShort(statement.period)}</span>
        {statement.status === 'paid' ? <Carimbo tone="ok">Pago</Carimbo> : null}
        {statement.reportedTotalCents === null ? null : (
          <span className="text-muted-foreground">
            informado <Money value={statement.reportedTotalCents} sign="never" />
          </span>
        )}
      </p>
      {overdue ? <p className="text-sm text-muted-foreground">{OVERDUE_UNPAID_HINT}</p> : null}
      {mismatch ? (
        <p className="text-sm text-destructive">
          Diferença da conciliação:{' '}
          {statement.differenceCents === null ? null : <Money value={statement.differenceCents} />}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <StatementPaidButton statement={statement} onChanged={onChanged} />
        <Link href="/importar" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 sm:min-h-0">
          Ver importação
        </Link>
      </div>
    </Canhoto>
  );
}
