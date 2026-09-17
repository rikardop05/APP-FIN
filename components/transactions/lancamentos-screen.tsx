'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { Plus, Tags } from 'lucide-react';
import { Button, EmptyState, PageHeader } from '@/components/ui-kit';
import { TransactionFilters, type TransactionFilterValues } from './transaction-filters';
import {
  BatchCategorizationDialog,
  ManualTransactionDialog,
  RuleDialog,
} from './transaction-dialogs';
import {
  transactionResponseSchema,
  ruleSuggestionSchema,
  type RuleSuggestion,
  type TransactionOptions,
  type TransactionResponse,
} from './schemas';
import { TransactionList, type TransactionEditValues } from './transaction-list';

const emptyFilters: TransactionFilterValues = {
  from: '',
  to: '',
  categoryId: '',
  accountId: '',
  creditCardId: '',
  memberId: '',
  search: '',
  uncategorized: false,
};

const emptyOptions: TransactionOptions = {
  categories: [],
  accounts: [],
  cards: [],
  members: [],
};

const idResponseSchema = z.object({ id: z.string().uuid() });
const batchResponseSchema = z.object({ updated: z.number().int() });

type DialogState =
  | { kind: 'manual' }
  | { kind: 'batch' }
  | { kind: 'rule'; transactionId: string }
  | null;

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

function queryString(filters: TransactionFilterValues): string {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  if (filters.accountId) params.set('accountId', filters.accountId);
  if (filters.creditCardId) params.set('creditCardId', filters.creditCardId);
  if (filters.memberId) params.set('memberId', filters.memberId);
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.uncategorized) params.set('uncategorized', 'true');
  const value = params.toString();
  return value ? `?${value}` : '';
}

function hasFilters(filters: TransactionFilterValues): boolean {
  return Object.entries(filters).some(([key, value]) => key === 'uncategorized' ? value === true : value !== '');
}

export function LancamentosScreen({ today }: { today: string }) {
  const [filters, setFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);
  const [data, setData] = useState<TransactionResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [ruleSuggestion, setRuleSuggestion] = useState<RuleSuggestion | null>(null);
  const [loadingRule, setLoadingRule] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextFilters: TransactionFilterValues) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/transactions${queryString(nextFilters)}`, { cache: 'no-store' });
      const result = await readJson(response, transactionResponseSchema);
      setData(result);
      setSelectedIds((previous) => previous.filter((id) => result.transactions.some((row) => row.id === id)));
      setEditingId(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os lançamentos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(appliedFilters); }, [appliedFilters, load]);

  const rows = data?.transactions ?? [];
  const options = data?.options ?? emptyOptions;

  function toggleSelection(id: string) {
    setSelectedIds((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
  }

  function toggleAll() {
    if (rows.every((row) => selectedIds.includes(row.id))) {
      setSelectedIds((previous) => previous.filter((id) => !rows.some((row) => row.id === id)));
    } else {
      setSelectedIds((previous) => [...new Set([...previous, ...rows.map((row) => row.id)])]);
    }
  }

  async function saveEdit(id: string, input: TransactionEditValues) {
    setBusy(true);
    try {
      const response = await fetch(`/api/transactions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      await readJson(response, idResponseSchema);
      await load(appliedFilters);
    } finally {
      setBusy(false);
    }
  }

  async function categorizeBatch(categoryId: string, memberId: string | null) {
    if (selectedIds.length === 0) return;
    setBusy(true);
    try {
      const response = await fetch('/api/transactions/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionIds: selectedIds, categoryId, memberId }),
      });
      await readJson(response, batchResponseSchema);
      setSelectedIds([]);
      setDialog(null);
      await load(appliedFilters);
    } finally {
      setBusy(false);
    }
  }

  async function createManual(values: Parameters<NonNullable<React.ComponentProps<typeof ManualTransactionDialog>['onSubmit']>>[0]) {
    setBusy(true);
    try {
      const response = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      await readJson(response, idResponseSchema);
      setDialog(null);
      await load(appliedFilters);
    } finally {
      setBusy(false);
    }
  }

  async function openRule(transactionId: string) {
    setDialog({ kind: 'rule', transactionId });
    setRuleSuggestion(null);
    setLoadingRule(true);
    try {
      const response = await fetch(`/api/transactions/${transactionId}/rule`, { cache: 'no-store' });
      setRuleSuggestion(await readJson(response, ruleSuggestionSchema));
    } catch (ruleError) {
      setError(ruleError instanceof Error ? ruleError.message : 'Não foi possível preparar a regra.');
      setDialog(null);
    } finally {
      setLoadingRule(false);
    }
  }

  async function createRule(pattern: string, categoryId: string, memberId: string | null) {
    if (dialog?.kind !== 'rule') return;
    setBusy(true);
    try {
      const response = await fetch(`/api/transactions/${dialog.transactionId}/rule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern, matchType: 'contains', categoryId, memberId, priority: 100 }),
      });
      await readJson(response, idResponseSchema);
      setDialog(null);
    } finally {
      setBusy(false);
    }
  }

  function submitFilters() {
    setAppliedFilters({ ...filters });
  }

  function clearFilters() {
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
  }

  return (
    <>
      <PageHeader
        title="Lançamentos"
        description="Receitas e despesas da família, filtráveis por período, categoria, cartão ou conta, responsável e texto."
        actions={<Button onClick={() => setDialog({ kind: 'manual' })}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />Novo lançamento</Button>}
      />

      {error ? <div role="alert" className="flex flex-col gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 sm:flex-row sm:items-center sm:justify-between"><span>{error}</span><Button variant="outline" size="sm" onClick={() => void load(appliedFilters)}>Tentar novamente</Button></div> : null}

      <TransactionFilters value={filters} options={options} busy={loading} onChange={(value) => setFilters((previous) => ({ ...previous, ...value }))} onSubmit={submitFilters} onClear={clearFilters} />

      {selectedIds.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium">{selectedIds.length} selecionado{selectedIds.length === 1 ? '' : 's'}</p>
          <Button size="sm" onClick={() => setDialog({ kind: 'batch' })}><Tags className="mr-2 h-4 w-4" aria-hidden="true" />Categorizar selecionados</Button>
        </div>
      ) : null}

      {loading ? <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">Carregando lançamentos…</div> : rows.length === 0 ? (
        <EmptyState
          title={hasFilters(appliedFilters) ? 'Nenhum lançamento encontrado' : 'Nenhum lançamento ainda'}
          description={hasFilters(appliedFilters) ? 'Ajuste os filtros ou limpe a busca para ver outros lançamentos.' : 'Registre um lançamento manual ou importe uma fatura ou extrato para começar.'}
          action={hasFilters(appliedFilters) ? { label: 'Limpar filtros', onClick: clearFilters } : { label: 'Novo lançamento', onClick: () => setDialog({ kind: 'manual' }) }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{rows.length} lançamento{rows.length === 1 ? '' : 's'} encontrado{rows.length === 1 ? '' : 's'}</p>
          <TransactionList rows={rows} options={options} selectedIds={selectedIds} onToggle={toggleSelection} onToggleAll={toggleAll} onEdit={setEditingId} onRule={openRule} editingId={editingId} onSaveEdit={saveEdit} onCancelEdit={() => setEditingId(null)} />
        </div>
      )}

      {dialog?.kind === 'manual' ? <ManualTransactionDialog today={today} options={options} busy={busy} onClose={() => setDialog(null)} onSubmit={createManual} /> : null}
      {dialog?.kind === 'batch' ? <BatchCategorizationDialog count={selectedIds.length} options={options} busy={busy} onClose={() => setDialog(null)} onSubmit={categorizeBatch} /> : null}
      {dialog?.kind === 'rule' ? <RuleDialog suggestion={ruleSuggestion} options={options} busy={busy} loading={loadingRule} onClose={() => setDialog(null)} onSubmit={createRule} /> : null}
    </>
  );
}
