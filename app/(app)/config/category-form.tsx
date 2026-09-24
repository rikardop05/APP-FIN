'use client';

import { useState, type FormEvent } from 'react';
import { Button, Input, Select } from '@/components/ui-kit';
import { Field } from './form-fields';
import { categoryFormSchema, type CategoryFormValues, type Nature } from './schemas';
import { natureLabel } from './labels';

type CategoryFormProps = {
  /** Raiz nao oferece `nature` (a natureza pertence a folha). */
  mode: 'root' | 'leaf';
  initial?: { name: string; nature: Nature; color: string | null; sortOrder: number };
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (values: CategoryFormValues) => void;
};

const NATURES: Nature[] = ['essential', 'non_essential', 'investment', 'income'];

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

export function CategoryForm({ mode, initial, busy = false, onCancel, onSubmit }: CategoryFormProps) {
  const [values, setValues] = useState<CategoryFormValues>(() => ({
    name: initial?.name ?? '',
    nature: initial?.nature ?? (mode === 'leaf' ? 'non_essential' : ''),
    color: initial?.color ?? '',
    sortOrder: String(initial?.sortOrder ?? 0),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});

  function update<K extends keyof CategoryFormValues>(field: K, value: CategoryFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: '' }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = categoryFormSchema.safeParse(values);
    if (!result.success) {
      setErrors(issueMap(result.error));
      return;
    }
    if (mode === 'leaf' && result.data.nature === '') {
      setErrors({ nature: 'Informe a natureza da subcategoria.' });
      return;
    }
    onSubmit(result.data);
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <Field label="Nome" htmlFor="category-name" error={errors.name}>
        <Input
          id="category-name"
          value={values.name}
          onChange={(event) => update('name', event.target.value)}
          autoComplete="off"
        />
      </Field>

      {mode === 'leaf' ? (
        <Field
          label="Natureza"
          htmlFor="category-nature"
          error={errors.nature}
          hint="Define se o gasto é essencial, não essencial, investimento ou receita."
        >
          <Select
            id="category-nature"
            value={values.nature}
            onChange={(event) => update('nature', event.target.value as Nature)}
          >
            {NATURES.map((nature) => (
              <option key={nature} value={nature}>
                {natureLabel[nature]}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <p className="rounded-md bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
          A natureza pertence às subcategorias. Crie subcategorias para classificar os lançamentos.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cor (opcional)" htmlFor="category-color" error={errors.color} hint="#RRGGBB">
          <Input
            id="category-color"
            value={values.color}
            onChange={(event) => update('color', event.target.value)}
            placeholder="#3b82f6"
            autoComplete="off"
          />
        </Field>
        <Field label="Ordem" htmlFor="category-order" error={errors.sortOrder}>
          <Input
            id="category-order"
            type="number"
            min={0}
            value={values.sortOrder}
            onChange={(event) => update('sortOrder', event.target.value)}
          />
        </Field>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Salvando…' : initial ? 'Salvar alterações' : 'Criar categoria'}
        </Button>
      </div>
    </form>
  );
}
