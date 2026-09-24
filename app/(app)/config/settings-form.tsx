'use client';

import { useState, type FormEvent } from 'react';
import { Button, Input } from '@/components/ui-kit';
import { Field } from './form-fields';
import { settingsFormSchema, type SettingsFormValues, type SettingsRecord } from './schemas';

type SettingsFormProps = {
  initial: SettingsRecord;
  busy?: boolean;
  onSubmit: (values: {
    emergencyFundMonths: number;
    budgetWarnBp: number;
    projectionMonths: number;
    commitmentMonths: number;
  }) => void;
};

/** Basis points -> percentual exibido: 8000 bp = 80. */
function bpToPercentText(bp: number): string {
  return String(bp / 100);
}

/** Percentual digitado -> basis points: 80 = 8000 bp. */
function percentTextToBp(text: string): number {
  return Math.round(Number(text.replace(',', '.')) * 100);
}

function issueMap(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const messages: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && messages[field] === undefined) {
      messages[field] = issue.message;
    }
  }
  return messages;
}

export function SettingsForm({ initial, busy = false, onSubmit }: SettingsFormProps) {
  const [values, setValues] = useState<SettingsFormValues>(() => ({
    emergencyFundMonths: String(initial.emergencyFundMonths),
    budgetWarnPercent: bpToPercentText(initial.budgetWarnBp),
    projectionMonths: String(initial.projectionMonths),
    commitmentMonths: String(initial.commitmentMonths),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});

  function update<K extends keyof SettingsFormValues>(field: K, value: SettingsFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: '' }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = settingsFormSchema.safeParse(values);
    if (!result.success) {
      setErrors(issueMap(result.error));
      return;
    }

    const emergencyFundMonths = Number(result.data.emergencyFundMonths);
    const projectionMonths = Number(result.data.projectionMonths);
    const commitmentMonths = Number(result.data.commitmentMonths);
    const budgetWarnBp = percentTextToBp(result.data.budgetWarnPercent);

    const rangeErrors: Record<string, string> = {};
    if (emergencyFundMonths < 1 || emergencyFundMonths > 60) rangeErrors.emergencyFundMonths = 'Entre 1 e 60 meses.';
    if (projectionMonths < 1 || projectionMonths > 60) rangeErrors.projectionMonths = 'Entre 1 e 60 meses.';
    if (commitmentMonths < 1 || commitmentMonths > 60) rangeErrors.commitmentMonths = 'Entre 1 e 60 meses.';
    if (budgetWarnBp < 1000 || budgetWarnBp > 10000) rangeErrors.budgetWarnPercent = 'Entre 10 % e 100 %.';
    if (Object.keys(rangeErrors).length > 0) {
      setErrors(rangeErrors);
      return;
    }

    onSubmit({ emergencyFundMonths, budgetWarnBp, projectionMonths, commitmentMonths });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Reserva de emergência (meses)"
          htmlFor="settings-emergency"
          error={errors.emergencyFundMonths}
          hint="Quantos meses de despesa essencial a reserva deve cobrir."
        >
          <Input
            id="settings-emergency"
            type="number"
            min={1}
            max={60}
            value={values.emergencyFundMonths}
            onChange={(event) => update('emergencyFundMonths', event.target.value)}
          />
        </Field>
        <Field
          label="Alerta de orçamento (%)"
          htmlFor="settings-budget-warn"
          error={errors.budgetWarnPercent}
          hint="Percentual do orçamento que acende o semáforo amarelo."
        >
          <Input
            id="settings-budget-warn"
            inputMode="decimal"
            value={values.budgetWarnPercent}
            onChange={(event) => update('budgetWarnPercent', event.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Projeção de fluxo (meses)"
          htmlFor="settings-projection"
          error={errors.projectionMonths}
          hint="Horizonte da projeção de caixa."
        >
          <Input
            id="settings-projection"
            type="number"
            min={1}
            max={60}
            value={values.projectionMonths}
            onChange={(event) => update('projectionMonths', event.target.value)}
          />
        </Field>
        <Field
          label="Comprometimento futuro (meses)"
          htmlFor="settings-commitment"
          error={errors.commitmentMonths}
          hint="Horizonte das parcelas futuras na tela de cartões."
        >
          <Input
            id="settings-commitment"
            type="number"
            min={1}
            max={60}
            value={values.commitmentMonths}
            onChange={(event) => update('commitmentMonths', event.target.value)}
          />
        </Field>
      </div>
      <div className="flex justify-end border-t border-border pt-4">
        <Button type="submit" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar premissas'}
        </Button>
      </div>
    </form>
  );
}
