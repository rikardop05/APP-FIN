'use client';

import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';

import { Badge, Button, Money, PageHeader } from '@/components/ui-kit';
import { formatBasisPoints } from '@/components/ui-kit/format-bp';
import { formatDateBR } from '@/lib/date';
import { basisPoints } from '@/lib/money';

import { positionsResponseSchema, type PositionsData, type Snapshot } from './schemas';
import {
  adherenceSummaryText,
  buildMonthRows,
  buildSnapshotBody,
  comparisonFor,
  comparisonLines,
  confirmationText,
  deleteQuestion,
  emptySnapshotValues,
  eventAfterSave,
  firstSnapshotErrorId,
  isCurrentPortfolio,
  NO_PLAN_TEXT,
  NOMINAL_NOTICE,
  NOTE_MAX,
  snapshotErrorSummary,
  snapshotToValues,
  sortSnapshots,
  applyToPlanQuestion,
  type PositionEvent,
  type SnapshotFormErrors,
  type SnapshotFormValues,
} from './view';

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring';

function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm">
      <label className="font-medium text-foreground" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      {error ? <span className="text-xs text-destructive" role="alert">{error}</span> : null}
    </div>
  );
}

async function readData(response: Response): Promise<PositionsData> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'Não foi possível concluir a operação.';
    throw new Error(message);
  }
  const parsed = positionsResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('A resposta do servidor está inválida.');
  return parsed.data;
}

const percent = (bp: number) => formatBasisPoints(basisPoints(bp));

const TONE_CLASS = {
  ahead: 'text-emerald-800',
  behind: 'text-amber-800',
  even: 'text-foreground',
  none: 'text-muted-foreground',
} as const;

export function PositionsScreen({ initial, today }: { initial: PositionsData; today: string }) {
  const [data, setData] = useState<PositionsData>(initial);
  const [values, setValues] = useState<SnapshotFormValues>(() => emptySnapshotValues(today));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<SnapshotFormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [event, setEvent] = useState<PositionEvent | null>(null);
  const [saving, setSaving] = useState(false);

  const rows = buildMonthRows(data);
  const summary = adherenceSummaryText(data.adherence, percent);
  const snapshots = sortSnapshots(data.snapshots);

  function accept(next: PositionsData, nextEvent: PositionEvent) {
    setData(next);
    setEvent(nextEvent);
    setFailure(null);
    setErrors({});
  }

  function edit(field: keyof SnapshotFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setEvent(null);
  }

  function resetForm() {
    setValues(emptySnapshotValues(today));
    setEditingId(null);
  }

  async function submit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    const built = buildSnapshotBody(values, today);
    if (!built.ok) {
      setErrors(built.errors);
      setFailure(snapshotErrorSummary(built.errors));
      const id = firstSnapshotErrorId(built.errors);
      if (id !== null) document.getElementById(id)?.focus();
      return;
    }
    setSaving(true);
    setFailure(null);
    setErrors({});
    try {
      const response = await fetch(
        editingId === null ? '/api/investment/positions' : `/api/investment/positions/${editingId}`,
        {
          method: editingId === null ? 'POST' : 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(built.body),
        },
      );
      const next = await readData(response);
      accept(next, eventAfterSave({ editing: editingId !== null, replaced: next.saved?.replaced }));
      resetForm();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Não foi possível registrar a posição.');
    } finally {
      setSaving(false);
    }
  }

  async function act(request: () => Promise<Response>, nextEvent: PositionEvent, fallback: string) {
    setFailure(null);
    setEvent(null);
    try {
      accept(await readData(await request()), nextEvent);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : fallback);
    }
  }

  function remove(snapshot: Snapshot) {
    if (!window.confirm(deleteQuestion(snapshot))) return;
    if (editingId === snapshot.id) resetForm();
    void act(() => fetch(`/api/investment/positions/${snapshot.id}`, { method: 'DELETE' }), 'deleted', 'Não foi possível apagar o registro.');
  }

  function applyToPlan(snapshot: Snapshot) {
    if (!window.confirm(applyToPlanQuestion(snapshot))) return;
    void act(
      () => fetch(`/api/investment/positions/${snapshot.id}/use-as-portfolio`, { method: 'POST' }),
      'applied',
      'Não foi possível atualizar o plano.',
    );
  }

  function startEdit(snapshot: Snapshot) {
    setEditingId(snapshot.id);
    setValues(snapshotToValues(snapshot));
    setErrors({});
    setFailure(null);
    setEvent(null);
    document.getElementById('position-form')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  return (
    <>
      <PageHeader
        title="Posição real"
        description="Quanto você realmente aportou e quanto tem investido, comparado ao plano."
        actions={<Link href="/investimentos" className="text-sm font-medium underline underline-offset-2">Voltar ao planejador</Link>}
      />

      <div className="mt-4 flex flex-col gap-1 rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm" role="note">
        <p><strong className="font-semibold">Valores em R$ de hoje.</strong> {NOMINAL_NOTICE}</p>
        <p className="text-muted-foreground">Retorno passado não é garantia de retorno futuro.</p>
      </div>

      {event ? (
        <p className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900" role="status">
          {confirmationText(event)}
        </p>
      ) : null}

      {data.plan === null ? (
        <section className="mt-6 rounded-lg border border-border bg-card p-4 sm:p-5" aria-labelledby="noplan-heading">
          <h2 id="noplan-heading" className="font-semibold">Sem plano de renda passiva</h2>
          <p className="mt-1 text-sm text-muted-foreground">{NO_PLAN_TEXT}</p>
          <Link href="/investimentos" className="mt-3 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Criar o plano em Investimentos
          </Link>
        </section>
      ) : null}

      <section className="mt-6 rounded-lg border border-border bg-card p-4 sm:p-5" aria-labelledby="adherence-heading">
        <h2 id="adherence-heading" className="font-semibold">Aporte efetivo × planejado</h2>
        {data.plan !== null ? (
          <p className="text-sm text-muted-foreground">
            Planejado: <Money value={data.plan.plannedMonthlyCents} sign="never" /> por mês. Os últimos 12 meses fechados e o mês em andamento.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">O que você aportou nos últimos 12 meses fechados e no mês em andamento.</p>
        )}
        {summary ? (
          <div className="mt-3 rounded-md bg-secondary/50 px-3 py-2 text-sm">
            <p className="font-medium">{summary.headline}</p>
            {summary.detail ? <p className="text-muted-foreground">{summary.detail}</p> : null}
          </div>
        ) : null}

        <ul className="mt-3 flex flex-col divide-y divide-border">
          {rows.map((row) => (
            <li key={row.competence} className="flex flex-col gap-1 py-2 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="flex items-center gap-2 font-medium">
                  {row.label}
                  {row.inProgress ? <Badge variant="neutral">em andamento</Badge> : null}
                  {row.state === 'before_plan' ? <Badge variant="neutral">antes do plano</Badge> : null}
                </span>
                <span>
                  <Money value={row.actualCents} sign="never" />
                  {row.plannedCents !== null ? (
                    <span className="text-muted-foreground"> de <Money value={row.plannedCents} sign="never" /></span>
                  ) : null}
                  {row.adherenceBp !== null ? (
                    <strong className={row.belowPlan && !row.inProgress ? 'ml-2 text-amber-800' : 'ml-2'}>{percent(row.adherenceBp)}</strong>
                  ) : null}
                </span>
              </div>
              {row.barBp !== null ? (
                <div
                  role="progressbar"
                  aria-label={`Aporte de ${row.label} em relação ao planejado`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(row.barBp / 100)}
                  className="h-2 w-full overflow-hidden rounded-full bg-secondary"
                >
                  <div className={`h-full rounded-full ${row.belowPlan && !row.inProgress ? 'bg-amber-500' : 'bg-primary'}`} style={{ width: `${row.barBp / 100}%` }} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section id="position-form" className="mt-6 rounded-lg border border-border bg-card p-4 sm:p-5" aria-labelledby="register-heading">
        <h2 id="register-heading" className="font-semibold">{editingId === null ? 'Registrar posição' : 'Editar registro'}</h2>
        <p className="text-sm text-muted-foreground">O total que você tem investido em uma data (soma de tudo, em R$ de hoje).</p>
        <form className="mt-4 flex flex-col gap-4" onSubmit={(submitEvent) => void submit(submitEvent)} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Data" htmlFor="position-date" error={errors.asOf} hint="Se já existe registro nesta data, ele é substituído.">
              <input id="position-date" type="date" max={today} className={inputClass} value={values.asOf} onChange={(e) => edit('asOf', e.target.value)} />
            </Field>
            <Field label="Total investido" htmlFor="position-amount" error={errors.amount}>
              <input id="position-amount" className={inputClass} value={values.amount} onChange={(e) => edit('amount', e.target.value)} inputMode="decimal" placeholder="R$ 0,00" />
            </Field>
          </div>
          <Field label="Observação (opcional)" htmlFor="position-note" error={errors.note} hint={`Até ${String(NOTE_MAX)} caracteres.`}>
            <input id="position-note" className={inputClass} value={values.note} onChange={(e) => edit('note', e.target.value)} autoComplete="off" />
          </Field>
          {failure ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{failure}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {editingId !== null ? <Button variant="outline" onClick={resetForm} disabled={saving}>Cancelar edição</Button> : null}
            <Button type="submit" disabled={saving}>{saving ? 'Salvando…' : editingId === null ? 'Registrar posição' : 'Salvar alterações'}</Button>
          </div>
        </form>
      </section>

      <section className="mt-6 flex flex-col gap-3" aria-labelledby="records-heading">
        <h2 id="records-heading" className="font-semibold">Registros e comparação com os cenários</h2>
        {snapshots.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhuma posição registrada ainda. Registre o total que você tem investido hoje para acompanhar se está na curva.
          </p>
        ) : (
          snapshots.map((snapshot) => {
            const lines = comparisonLines(comparisonFor(data, snapshot));
            const current = isCurrentPortfolio(data, snapshot);
            return (
              <article key={snapshot.id} className="rounded-lg border border-border bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-semibold"><Money value={snapshot.portfolioCents} sign="never" /></p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateBR(snapshot.asOf)}
                      {snapshot.note ? ` · ${snapshot.note}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" onClick={() => startEdit(snapshot)}>Editar</Button>
                    <Button variant="outline" size="sm" onClick={() => remove(snapshot)}>Apagar</Button>
                  </div>
                </div>

                {lines.length > 0 ? (
                  <ul className="mt-3 flex flex-col gap-1 text-sm">
                    {lines.map((line) => (
                      <li key={line.label || line.text} className={TONE_CLASS[line.tone]}>{line.text}</li>
                    ))}
                  </ul>
                ) : null}

                {data.plan !== null ? (
                  <div className="mt-3 border-t border-border pt-3">
                    {current ? (
                      <p className="text-xs text-muted-foreground">Este registro já é o patrimônio atual do plano.</p>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => applyToPlan(snapshot)}>Usar como patrimônio atual do plano</Button>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </section>
    </>
  );
}
