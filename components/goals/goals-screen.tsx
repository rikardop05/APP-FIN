'use client';

import { useCallback, useEffect, useState } from 'react';
import { PiggyBank, Pencil, Plus, Target, Trash2 } from 'lucide-react';

import { BAR_X_CLASS, barScaleStyle } from '@/components/dashboard/bar-scale';
import { Badge, Button, DateText, EmptyState, Money, PageHeader } from '@/components/ui-kit';
import { formatBasisPoints } from '@/components/ui-kit/format-bp';
import { basisPoints } from '@/lib/money';

import { deadlineSummary } from './describe';
import { GoalForm } from './goal-form';
import type { GoalRequestBody } from './form-body';
import { goalsResponseSchema, type GoalsResponse, type GoalView } from './schemas';

type DialogState = { goal?: GoalView; emergencyDraft?: boolean };

const statusLabel: Record<GoalView['status'], string> = {
  active: 'Ativa',
  achieved: 'Atingida',
  paused: 'Pausada',
  cancelled: 'Cancelada',
};

async function readGoals(response: Response): Promise<GoalsResponse> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'Não foi possível concluir a operação.';
    throw new Error(message);
  }
  const parsed = goalsResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('A resposta do servidor está inválida.');
  return parsed.data;
}

function ProgressBar({ bp, label }: { bp: number; label: string }) {
  const percent = Math.min(100, Math.max(0, bp / 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className="h-2.5 w-full overflow-hidden bg-secondary"
    >
      <div className={`${BAR_X_CLASS} bg-primary`} style={barScaleStyle(percent, 'x')} />
    </div>
  );
}

function DeadlineLine({ goal }: { goal: GoalView }) {
  const summary = deadlineSummary(goal);
  switch (summary.kind) {
    case 'no-target':
      return <p className="text-sm text-muted-foreground">Ainda não há histórico para calcular o alvo desta reserva.</p>;
    case 'zero-target':
      return <p className="text-sm text-muted-foreground">O alvo calculado é R$ 0,00: não há despesa essencial categorizada nos meses fechados.</p>;
    case 'done':
      return <p className="text-sm font-medium text-emerald-700">Meta atingida.</p>;
    case 'no-deadline':
      return <p className="text-sm text-muted-foreground">Sem data-alvo: o aporte mensal não é calculado.</p>;
    case 'monthly':
      return (
        <p className="text-sm">
          Aporte mensal necessário{' '}
          <strong className="font-semibold"><Money value={summary.requiredMonthlyCents} sign="never" /></strong>{' '}
          <span className="text-muted-foreground">por {summary.months} {summary.months === 1 ? 'mês' : 'meses'}</span>
        </p>
      );
    case 'due-now':
      return (
        <p className="text-sm">
          O prazo é neste mês: faltam <strong className="font-semibold"><Money value={summary.remainingCents} sign="never" /></strong>.
        </p>
      );
    case 'overdue':
      return (
        <p className="text-sm text-destructive">
          Prazo vencido: faltam <strong className="font-semibold"><Money value={summary.remainingCents} sign="never" /></strong>.
        </p>
      );
  }
}

function GoalCard({ goal, onEdit, onDelete }: { goal: GoalView; onEdit: () => void; onDelete: () => void }) {
  const progress = goal.progress;
  return (
    <article className="border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words font-semibold">{goal.name}</h3>
            {goal.isEmergencyFund ? <Badge variant="neutral">Reserva</Badge> : null}
            {goal.status !== 'active' ? <Badge variant={goal.status === 'achieved' ? 'success' : 'warning'}>{statusLabel[goal.status]}</Badge> : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {goal.targetDate === null ? 'Sem data-alvo' : <>Até <DateText value={goal.targetDate} /></>}
            {goal.accountName !== null ? ` · Saldo de ${goal.accountName}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="sm" aria-label={`Editar ${goal.name}`} onClick={onEdit}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" aria-label={`Excluir ${goal.name}`} onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {progress !== null && goal.targetCents !== null ? (
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span><Money value={goal.currentCents} sign="never" /> de <Money value={goal.targetCents} sign="never" /></span>
            <span className="font-medium">{formatBasisPoints(basisPoints(progress.progressBp))}</span>
          </div>
          <ProgressBar bp={progress.progressBp} label={`Progresso de ${goal.name}`} />
        </div>
      ) : null}
      <div className="mt-3">
        <DeadlineLine goal={goal} />
      </div>
    </article>
  );
}

function EmergencySuggestion({ data, onCreate }: { data: GoalsResponse['emergency']; onCreate: () => void }) {
  return (
    <section aria-labelledby="emergency-heading" className="border border-primary/30 bg-primary/5 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <PiggyBank className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          <h2 id="emergency-heading" className="font-semibold">Reserva de emergência</h2>
          {data.averageCents === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Há lançamentos nos meses fechados, mas nenhuma despesa essencial categorizada. Categorize suas despesas para o alvo ({data.months} × a média das essenciais) aparecer.
            </p>
          ) : data.targetCents !== null && data.averageCents !== null ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Sugestão: <strong className="text-foreground"><Money value={data.targetCents} sign="never" /></strong>, ou seja,{' '}
              {data.months} × <Money value={data.averageCents} sign="never" /> de despesa essencial por mês (média de{' '}
              {data.monthsWithData} {data.monthsWithData === 1 ? 'mês fechado' : 'meses fechados'}).
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Ainda não há meses fechados com lançamentos para calcular a sugestão. Importe ou lance suas despesas, e o alvo ({data.months} × a média das despesas essenciais) aparece aqui.
            </p>
          )}
          <Button className="mt-3" size="sm" onClick={onCreate}>Criar meta de reserva</Button>
        </div>
      </div>
    </section>
  );
}

export function GoalsScreen() {
  const [data, setData] = useState<GoalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await readGoals(await fetch('/api/goals', { cache: 'no-store' })));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar as metas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(body: GoalRequestBody, id?: string) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(id === undefined ? '/api/goals' : `/api/goals/${id}`, {
        method: id === undefined ? 'POST' : 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      setData(await readGoals(response));
      setDialog(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar a meta.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(goal: GoalView) {
    if (!window.confirm(`Excluir a meta "${goal.name}"?`)) return;
    setError(null);
    try {
      setData(await readGoals(await fetch(`/api/goals/${goal.id}`, { method: 'DELETE' })));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Não foi possível excluir a meta.');
    }
  }

  const goals = data?.goals ?? [];

  return (
    <>
      <PageHeader
        title="Metas"
        description="Metas com valor-alvo e data-alvo, e reserva de emergência sugerida."
        actions={<Button onClick={() => setDialog({})}><Plus className="mr-1 h-4 w-4" aria-hidden="true" />Nova meta</Button>}
      />

      {error ? <p className="mb-4 border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando metas…</p>
      ) : data === null ? null : (
        <div className="flex flex-col gap-6">
          {data.emergency.exists ? null : <EmergencySuggestion data={data.emergency} onCreate={() => setDialog({ emergencyDraft: true })} />}

          {goals.length === 0 ? (
            <EmptyState
              icon={Target}
              title="Nenhuma meta cadastrada"
              description="Crie uma meta para acompanhar o aporte mensal necessário e o progresso."
              action={{ label: 'Criar meta', onClick: () => setDialog({}) }}
            />
          ) : (
            <section aria-label="Metas por prioridade" className="flex flex-col gap-3">
              {goals.map((goal) => (
                <GoalCard key={goal.id} goal={goal} onEdit={() => setDialog({ goal })} onDelete={() => void remove(goal)} />
              ))}
            </section>
          )}
        </div>
      )}

      {dialog && data ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/20 p-0 sm:items-center sm:p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialog(null);
          }}
        >
          <div className="max-h-[90vh] w-full overflow-y-auto border border-border bg-background p-4 shadow-lg sm:max-w-lg sm:p-6" role="dialog" aria-modal="true" aria-labelledby="goal-dialog-title">
            <div className="mb-5 flex items-start justify-between gap-4">
              <h2 id="goal-dialog-title" className="text-lg font-semibold">{dialog.goal ? 'Editar meta' : 'Nova meta'}</h2>
              <Button variant="ghost" size="sm" aria-label="Fechar" onClick={() => setDialog(null)}>Fechar</Button>
            </div>
            <GoalForm
              key={dialog.goal?.id ?? (dialog.emergencyDraft ? 'new-emergency' : 'new-goal')}
              initial={dialog.goal}
              emergencyDraft={dialog.emergencyDraft}
              accounts={data.accounts}
              emergencyMonths={data.emergency.months}
              busy={saving}
              onCancel={() => setDialog(null)}
              onSubmit={(body, id) => void save(body, id)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
