'use client';

import { useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui-kit';

import {
  goalFormToBody,
  initialGoalValues,
  type GoalFormValues,
  type GoalRequestBody,
} from './form-body';
import type { GoalAccountOption, GoalView } from './schemas';

type GoalFormProps = {
  initial?: GoalView;
  /** Nova meta já como reserva de emergência (vem do cartão de sugestão). */
  emergencyDraft?: boolean;
  accounts: GoalAccountOption[];
  emergencyMonths: number;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: GoalRequestBody, id?: string) => void;
};

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring';

function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label className="font-medium text-foreground" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      {error ? <span className="text-xs text-destructive" role="alert">{error}</span> : null}
    </div>
  );
}

export function GoalForm({ initial, emergencyDraft = false, accounts, emergencyMonths, busy, onCancel, onSubmit }: GoalFormProps) {
  const [values, setValues] = useState<GoalFormValues>(() => initialGoalValues(initial, emergencyDraft));
  const [errors, setErrors] = useState<Partial<Record<keyof GoalFormValues, string>>>({});

  function update<K extends keyof GoalFormValues>(field: K, value: GoalFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = goalFormToBody(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    onSubmit(result.body, initial?.id);
  }

  const linked = values.accountId !== '';

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <Field label="Nome da meta" htmlFor="goal-name" error={errors.name}>
        <input id="goal-name" className={inputClass} value={values.name} onChange={(event) => update('name', event.target.value)} autoComplete="off" />
      </Field>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4"
          checked={values.isEmergencyFund}
          disabled={initial !== undefined}
          onChange={(event) => update('isEmergencyFund', event.target.checked)}
        />
        <span>
          <span className="font-medium">É a reserva de emergência</span>
          <span className="block text-xs text-muted-foreground">
            O alvo é calculado: {emergencyMonths} × a média mensal das despesas essenciais. Você não digita o valor.
          </span>
        </span>
      </label>

      {values.isEmergencyFund ? null : (
        <Field label="Valor-alvo" htmlFor="goal-target" error={errors.target}>
          <input id="goal-target" className={inputClass} value={values.target} onChange={(event) => update('target', event.target.value)} inputMode="decimal" placeholder="R$ 10.000,00" />
        </Field>
      )}

      <Field label="Data-alvo (opcional)" htmlFor="goal-date" error={errors.targetDate} hint="Com data, mostramos o aporte mensal necessário. Sem data, ele não é calculado.">
        <input id="goal-date" type="date" className={inputClass} value={values.targetDate} onChange={(event) => update('targetDate', event.target.value)} />
      </Field>

      <Field label="Conta vinculada (opcional)" htmlFor="goal-account" hint="Vinculada, o valor atual é o saldo da conta.">
        <select id="goal-account" className={inputClass} value={values.accountId} onChange={(event) => update('accountId', event.target.value)}>
          <option value="">Sem vínculo (informo o valor)</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>{account.name}</option>
          ))}
        </select>
      </Field>

      {linked ? null : (
        <Field label="Valor atual" htmlFor="goal-current" error={errors.current}>
          <input id="goal-current" className={inputClass} value={values.current} onChange={(event) => update('current', event.target.value)} inputMode="decimal" placeholder="R$ 0,00" />
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Prioridade" htmlFor="goal-priority" error={errors.priority} hint="Número menor aparece primeiro.">
          <input id="goal-priority" className={inputClass} value={values.priority} onChange={(event) => update('priority', event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Situação" htmlFor="goal-status">
          <select
            id="goal-status"
            className={inputClass}
            value={values.status}
            onChange={(event) => {
              const next = event.target.value;
              if (next === 'active' || next === 'paused' || next === 'achieved') update('status', next);
            }}
          >
            <option value="active">Ativa</option>
            <option value="paused">Pausada</option>
            <option value="achieved">Atingida</option>
          </select>
        </Field>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel} disabled={busy}>Cancelar</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Salvando…' : initial ? 'Salvar alterações' : 'Criar meta'}</Button>
      </div>
    </form>
  );
}
