'use client';

import { useState, type FormEvent } from 'react';
import { Button, DateField, Input, Select } from '@/components/ui-kit';
import type { AccountRecord, AccountFormData, AccountFormValues } from './schemas';
import { cents, formatBRL, parseBRL } from '@/lib/money';
import { accountFormSchema } from './schemas';
import { Field } from './form-fields';

type AccountFormProps = {
  initial?: AccountRecord;
  today: string;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (values: AccountFormData, id?: string) => void;
};

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

function initialValues(initial: AccountRecord | undefined, today: string): AccountFormValues {
  return {
    name: initial?.name ?? '',
    bank: initial?.bank ?? '',
    kind: initial?.kind ?? 'checking',
    openingBalance: initial ? formatBRL(initial.openingBalanceCents) : formatBRL(cents(0)),
    openingDate: initial?.openingDate ?? today,
  };
}

export function AccountForm({
  initial,
  today,
  busy = false,
  onCancel,
  onSubmit,
}: AccountFormProps) {
  const [values, setValues] = useState<AccountFormValues>(() => initialValues(initial, today));
  const [errors, setErrors] = useState<Record<string, string>>({});

  function update<K extends keyof AccountFormValues>(field: K, value: AccountFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: '' }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = accountFormSchema.safeParse(values);
    if (!result.success) {
      setErrors(issueMap(result.error));
      return;
    }
    const cents = parseBRL(result.data.openingBalance);
    if (cents === null) {
      setErrors({ openingBalance: 'Informe um valor válido.' });
      return;
    }
    onSubmit({ ...result.data, openingBalance: result.data.openingBalance }, initial?.id);
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome da conta" htmlFor="account-name" error={errors.name}>
          <Input
            id="account-name"
            value={values.name}
            onChange={(event) => update('name', event.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label="Banco (opcional)" htmlFor="account-bank" error={errors.bank}>
          <Input
            id="account-bank"
            value={values.bank}
            onChange={(event) => update('bank', event.target.value)}
            autoComplete="organization"
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo" htmlFor="account-kind" error={errors.kind}>
          <Select
            id="account-kind"
            value={values.kind}
            onChange={(event) => {
              const result = accountFormSchema.shape.kind.safeParse(event.target.value);
              if (result.success) update('kind', result.data);
            }}
          >
            <option value="checking">Conta corrente</option>
            <option value="savings">Poupança</option>
            <option value="cash">Dinheiro</option>
            <option value="brokerage">Corretora</option>
          </Select>
        </Field>
        <Field label="Data do saldo inicial" htmlFor="account-opening-date" error={errors.openingDate}>
          <DateField id="account-opening-date" value={values.openingDate} onChange={(iso) => update('openingDate', iso)} />
        </Field>
      </div>
      <Field label="Saldo inicial" htmlFor="account-opening-balance" error={errors.openingBalance}>
        <Input
          id="account-opening-balance"
          value={values.openingBalance}
          onChange={(event) => update('openingBalance', event.target.value)}
          inputMode="decimal"
          placeholder="R$ 0,00"
        />
      </Field>
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Salvando…' : initial ? 'Salvar alterações' : 'Criar conta'}
        </Button>
      </div>
    </form>
  );
}
