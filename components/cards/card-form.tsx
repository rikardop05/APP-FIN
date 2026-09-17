'use client';

import { useState, type FormEvent } from 'react';
import { formatBRL, parseBRL } from '@/lib/money';
import { Button } from '@/components/ui-kit';
import type {
  AccountRecord,
  CardFormData,
  CardFormValues,
  CardRecord,
  CardList,
} from './schemas';
import { cardFormSchema } from './schemas';
import { Field, inputClassName, selectClassName } from './form-fields';

type CardFormProps = {
  initial?: CardRecord;
  accounts: AccountRecord[];
  members: CardList['members'];
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (values: CardFormData, id?: string) => void;
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

function initialValues(initial?: CardRecord): CardFormValues {
  return {
    name: initial?.name ?? '',
    bank: initial?.bank ?? '',
    brand: initial?.brand ?? 'other',
    holderMemberId: initial?.holderMemberId ?? null,
    paymentAccountId: initial?.paymentAccountId ?? null,
    creditLimit: initial?.creditLimitCents === null || initial === undefined ? '' : formatBRL(initial.creditLimitCents),
    closingDay: String(initial?.closingDay ?? 1),
    dueDay: String(initial?.dueDay ?? 10),
  };
}

export function CardForm({
  initial,
  accounts,
  members,
  busy = false,
  onCancel,
  onSubmit,
}: CardFormProps) {
  const [values, setValues] = useState<CardFormValues>(() => initialValues(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});

  function update<K extends keyof CardFormValues>(field: K, value: CardFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: '' }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = cardFormSchema.safeParse(values);
    if (!result.success) {
      setErrors(issueMap(result.error));
      return;
    }
    const cents = result.data.creditLimit.length === 0 ? null : parseBRL(result.data.creditLimit);
    if (result.data.creditLimit.length > 0 && cents === null) {
      setErrors({ creditLimit: 'Informe um valor válido.' });
      return;
    }
    onSubmit(result.data, initial?.id);
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome do cartão" htmlFor="card-name" error={errors.name}>
          <input
            id="card-name"
            className={inputClassName}
            value={values.name}
            onChange={(event) => update('name', event.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label="Banco (opcional)" htmlFor="card-bank" error={errors.bank}>
          <input
            id="card-bank"
            className={inputClassName}
            value={values.bank}
            onChange={(event) => update('bank', event.target.value)}
            autoComplete="organization"
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bandeira" htmlFor="card-brand" error={errors.brand}>
          <select
            id="card-brand"
            className={selectClassName}
            value={values.brand}
            onChange={(event) => {
              const result = cardFormSchema.shape.brand.safeParse(event.target.value);
              if (result.success) update('brand', result.data);
            }}
          >
            <option value="visa">Visa</option>
            <option value="mastercard">Mastercard</option>
            <option value="elo">Elo</option>
            <option value="amex">American Express</option>
            <option value="other">Outra</option>
          </select>
        </Field>
        <Field label="Responsável (opcional)" htmlFor="card-holder" error={errors.holderMemberId}>
          <select
            id="card-holder"
            className={selectClassName}
            value={values.holderMemberId ?? ''}
            onChange={(event) => update('holderMemberId', event.target.value || null)}
          >
            <option value="">Família</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Limite (opcional)" htmlFor="card-limit" error={errors.creditLimit}>
          <input
            id="card-limit"
            className={inputClassName}
            value={values.creditLimit}
            onChange={(event) => update('creditLimit', event.target.value)}
            inputMode="decimal"
            placeholder="R$ 0,00"
          />
        </Field>
        <Field label="Conta para pagamento" htmlFor="card-payment-account" error={errors.paymentAccountId}>
          <select
            id="card-payment-account"
            className={selectClassName}
            value={values.paymentAccountId ?? ''}
            onChange={(event) => update('paymentAccountId', event.target.value || null)}
          >
            <option value="">Selecionar depois</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Dia de fechamento" htmlFor="card-closing-day" error={errors.closingDay}>
          <input
            id="card-closing-day"
            type="number"
            min={1}
            max={31}
            className={inputClassName}
            value={values.closingDay}
            onChange={(event) => update('closingDay', event.target.value)}
          />
        </Field>
        <Field label="Dia de vencimento" htmlFor="card-due-day" error={errors.dueDay}>
          <input
            id="card-due-day"
            type="number"
            min={1}
            max={31}
            className={inputClassName}
            value={values.dueDay}
            onChange={(event) => update('dueDay', event.target.value)}
          />
        </Field>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Salvando…' : initial ? 'Salvar alterações' : 'Criar cartão'}
        </Button>
      </div>
    </form>
  );
}
