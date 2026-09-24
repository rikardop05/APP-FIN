'use client';

import { useState, type FormEvent } from 'react';
import { Button, Checkbox, Input, Select } from '@/components/ui-kit';
import { Field } from './form-fields';
import { ruleFormSchema, type MatchType, type RuleFormValues, type RuleRecord } from './schemas';
import { matchTypeLabel } from './labels';

export type CategoryOption = { id: string; label: string };

type RuleFormProps = {
  initial?: RuleRecord;
  categories: CategoryOption[];
  members: { id: string; name: string }[];
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (values: RuleFormValues) => void;
};

const MATCH_TYPES: MatchType[] = ['contains', 'regex', 'exact'];

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

export function RuleForm({
  initial,
  categories,
  members,
  busy = false,
  onCancel,
  onSubmit,
}: RuleFormProps) {
  const [values, setValues] = useState<RuleFormValues>(() => ({
    pattern: initial?.pattern ?? '',
    matchType: initial?.matchType ?? 'contains',
    categoryId: initial?.categoryId ?? categories[0]?.id ?? '',
    memberId: initial?.memberId ?? '',
    active: initial?.active ?? true,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});

  function update<K extends keyof RuleFormValues>(field: K, value: RuleFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: '' }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = ruleFormSchema.safeParse(values);
    if (!result.success) {
      setErrors(issueMap(result.error));
      return;
    }
    onSubmit(result.data);
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <Field
        label="Padrão"
        htmlFor="rule-pattern"
        error={errors.pattern}
        hint="Comparado com a descrição normalizada (sem acento, minúscula)."
      >
        <Input
          id="rule-pattern"
          value={values.pattern}
          onChange={(event) => update('pattern', event.target.value)}
          autoComplete="off"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo de correspondência" htmlFor="rule-match-type" error={errors.matchType}>
          <Select
            id="rule-match-type"
            value={values.matchType}
            onChange={(event) => update('matchType', event.target.value as MatchType)}
          >
            {MATCH_TYPES.map((type) => (
              <option key={type} value={type}>
                {matchTypeLabel[type]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Categoria" htmlFor="rule-category" error={errors.categoryId}>
          <Select
            id="rule-category"
            value={values.categoryId}
            onChange={(event) => update('categoryId', event.target.value)}
          >
            {categories.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Responsável (opcional)" htmlFor="rule-member" error={errors.memberId}>
        <Select
          id="rule-member"
          value={values.memberId}
          onChange={(event) => update('memberId', event.target.value)}
        >
          <option value="">Família</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </Select>
      </Field>

      <Checkbox
        label="Regra ativa"
        checked={values.active}
        onChange={(event) => update('active', event.target.checked)}
      />

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Salvando…' : initial ? 'Salvar alterações' : 'Criar regra'}
        </Button>
      </div>
    </form>
  );
}
