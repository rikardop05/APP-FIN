'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, Checkbox, EmptyState, Input, Money, PageHeader, Select } from '@/components/ui-kit';
import {
  categoryChoices,
  confirmationBody,
  initialDraft,
  reviewResultMessage,
  type ReviewDraft,
} from './review-presentation';
import {
  reviewResponseSchema,
  reviewResultSchema,
  type ReviewCategory,
  type ReviewGroup,
} from './schemas';

async function readJson<T>(response: Response, schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error
      : 'Não foi possível concluir a operação.';
    throw new Error(message);
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new Error('A resposta do servidor está inválida.');
  return result.data;
}

/**
 * "Revisar sem categoria" (F4): os lancamentos sem categoria agrupados por loja,
 * o grupo que mais pesa primeiro. Cada grupo e uma decisao: categoria e, com
 * "Criar regra" marcado, a regra que categoriza a loja nas proximas faturas.
 */
export function ReviewScreen() {
  const [groups, setGroups] = useState<ReviewGroup[] | null>(null);
  const [categories, setCategories] = useState<ReviewCategory[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch('/api/transactions/review', { cache: 'no-store' });
      const data = await readJson(response, reviewResponseSchema);
      setGroups(data.groups);
      setCategories(data.categories);
      // Recarregar nao apaga o que o usuario ja editou nos grupos que ficaram.
      setDrafts((previous) => Object.fromEntries(data.groups.map((group) => [group.key, previous[group.key] ?? initialDraft(group)])));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a revisão.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function updateDraft(key: string, change: Partial<ReviewDraft>) {
    setDrafts((previous) => {
      const current = previous[key];
      return current === undefined ? previous : { ...previous, [key]: { ...current, ...change } };
    });
  }

  async function confirm(group: ReviewGroup) {
    const draft = drafts[group.key];
    if (draft === undefined) return;
    const prepared = confirmationBody(group, draft);
    if (!prepared.ok) {
      setError(prepared.message);
      return;
    }
    setBusyKey(group.key);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/transactions/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prepared.body),
      });
      const result = await readJson(response, reviewResultSchema);
      setNotice(`“${group.sampleDescriptions[0] ?? group.pattern}”: ${reviewResultMessage(result)}`);
      await load();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : 'Não foi possível confirmar o grupo.');
    } finally {
      setBusyKey(null);
    }
  }

  const pending = groups ?? [];
  const totalRows = pending.reduce((sum, group) => sum + group.count, 0);

  return (
    <>
      <PageHeader
        title="Revisar sem categoria"
        description="Lançamentos sem categoria agrupados por loja, do grupo que mais pesa para o que menos pesa. Escolha a categoria; com “Criar regra” marcado, a loja passa a ser categorizada sozinha nas próximas importações."
        actions={<Link href="/lancamentos" className="text-sm font-medium text-primary underline-offset-4 hover:underline">Voltar aos lançamentos</Link>}
      />

      {error ? <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div> : null}
      {notice ? <div role="status" className="flex items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><span>{notice}</span><Button variant="ghost" size="sm" onClick={() => setNotice(null)}>Fechar</Button></div> : null}

      {groups === null ? (
        error ? null : <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">Carregando…</div>
      ) : pending.length === 0 ? (
        <EmptyState
          title="Nada a revisar"
          description="Todos os gastos e receitas têm categoria. Pagamentos de fatura, transferências e previsões de despesa fixa não entram aqui."
          action={{ label: 'Voltar aos lançamentos', href: '/lancamentos' }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {pending.length} grupo{pending.length === 1 ? '' : 's'}, {totalRows} lançamento{totalRows === 1 ? '' : 's'} sem categoria
          </p>
          <ul className="flex flex-col gap-3">
            {pending.map((group) => {
              const draft = drafts[group.key] ?? initialDraft(group);
              const choices = categoryChoices(categories, group.direction);
              const busy = busyKey === group.key;
              const fieldId = `review-${group.key}`;
              return (
                <li key={group.key} className="flex flex-col gap-3 rounded-lg border border-border p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{group.sampleDescriptions.join(' · ')}</p>
                      <p className="text-xs text-muted-foreground">
                        {group.count} lançamento{group.count === 1 ? '' : 's'} · {group.direction === 'in' ? 'entrada' : 'saída'}
                        {group.ruleId !== null ? <> · já reconhecido pela regra &ldquo;{group.pattern}&rdquo;</> : null}
                      </p>
                    </div>
                    <span className="whitespace-nowrap text-base font-semibold"><Money value={group.totalCents} /></span>
                  </div>
                  <form
                    className="flex flex-col gap-3 sm:flex-row sm:items-end"
                    onSubmit={(event) => { event.preventDefault(); void confirm(group); }}
                  >
                    <label className="flex flex-1 flex-col gap-1 text-sm" htmlFor={`${fieldId}-category`}>
                      <span className="text-xs text-muted-foreground">Categoria</span>
                      <Select id={`${fieldId}-category`} value={draft.categoryId} onChange={(event) => updateDraft(group.key, { categoryId: event.target.value })} required>
                        <option value="">Selecione</option>
                        {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
                      </Select>
                    </label>
                    {group.ruleId === null ? (
                      <div className="flex flex-1 flex-col gap-1 text-sm">
                        <Checkbox label="Criar regra (contém)" checked={draft.createRule} onChange={() => updateDraft(group.key, { createRule: !draft.createRule })} />
                        <Input
                          aria-label="Padrão da regra"
                          value={draft.pattern}
                          onChange={(event) => updateDraft(group.key, { pattern: event.target.value })}
                          disabled={!draft.createRule}
                          placeholder="Trecho da descrição"
                          maxLength={120}
                        />
                      </div>
                    ) : null}
                    <Button type="submit" disabled={busy || busyKey !== null || draft.categoryId === ''}>
                      {busy ? 'Gravando…' : `Categorizar ${String(group.count)}`}
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
