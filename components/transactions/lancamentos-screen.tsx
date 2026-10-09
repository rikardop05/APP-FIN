'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { cents } from '@/lib/money';
import { Plus, Tags, Wand2 } from 'lucide-react';
import { Button, EmptyState, PageHeader } from '@/components/ui-kit';
import { TransactionFilters } from './transaction-filters';
import { applyDelayMs, EMPTY_FILTERS, type TransactionFilterValues } from './filter-presentation';
import {
  BatchCategorizationDialog,
  DeleteTransactionDialog,
  ManualTransactionDialog,
  ReconcileQuestionDialog,
  RuleDialog,
} from './transaction-dialogs';
import type { ReconcileSuggestion } from './reconcile-question';
import { ApplyRulesDialog } from './apply-rules-dialog';
import { applyResultMessage } from './apply-rules-presentation';
import { RuleOfferDialog } from './rule-offer-dialog';
import { ruleOfferAcceptedMessage, shouldOfferAfterEdit } from './rule-offer-presentation';
import {
  deleteResultSchema,
  ruleApplicationPreviewSchema,
  ruleApplicationResultSchema,
  type RuleApplicationPreview,
  ruleOfferAcceptedSchema,
  ruleOfferResponseSchema,
  type RuleOffer,
  transactionResponseSchema,
  ruleSuggestionSchema,
  type RuleSuggestion,
  type TransactionOptions,
  type TransactionResponse,
} from './schemas';
import { TransactionList, type TransactionEditValues } from './transaction-list';
import { listContentState, sortForDisplay } from './list-presentation';

const emptyOptions: TransactionOptions = {
  categories: [],
  accounts: [],
  cards: [],
  members: [],
};

const idResponseSchema = z.object({ id: z.string().uuid() });
const batchResponseSchema = z.object({ updated: z.number().int() });

type ManualValues = Parameters<NonNullable<React.ComponentProps<typeof ManualTransactionDialog>['onSubmit']>>[0];

const suggestionResponseSchema = z.object({
  suggestion: z
    .object({ plannedId: z.string().uuid(), description: z.string(), occurredOn: z.string(), amountCents: z.number().int() })
    .nullable(),
});

type DialogState =
  | { kind: 'manual'; initial?: ManualValues }
  | { kind: 'reconcile'; values: ManualValues; suggestion: ReconcileSuggestion }
  | { kind: 'batch' }
  | { kind: 'rule'; transactionId: string }
  | { kind: 'delete'; transactionId: string }
  | { kind: 'apply'; title: string; preview: RuleApplicationPreview }
  | { kind: 'offer'; transactionIds: string[]; offer: RuleOffer }
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
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [data, setData] = useState<TransactionResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [ruleSuggestion, setRuleSuggestion] = useState<RuleSuggestion | null>(null);
  const [loadingRule, setLoadingRule] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Resultado de uma acao que deu certo (ex.: "5 lancamentos categorizados").
  const [notice, setNotice] = useState<string | null>(null);
  // `error` e compartilhado por carga E acoes (criar regra, categorizar, excluir).
  // O estado vazio enganoso so nasce da FALHA DE CARGA, entao ela tem flag
  // propria: uma acao que falha mostra o alerta sem esconder a lista carregada.
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async (nextFilters: TransactionFilterValues) => {
    setLoading(true);
    setError(null);
    setLoadFailed(false);
    try {
      const response = await fetch(`/api/transactions${queryString(nextFilters)}`, { cache: 'no-store' });
      const result = await readJson(response, transactionResponseSchema);
      setData(result);
      setSelectedIds((previous) => previous.filter((id) => result.transactions.some((row) => row.id === id)));
      setEditingId(null);
    } catch (loadError) {
      setLoadFailed(true);
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os lançamentos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(appliedFilters); }, [appliedFilters, load]);

  // Filtros aplicam sozinhos: campos discretos na hora, texto com atraso curto (sem botao Filtrar).
  useEffect(() => {
    const delay = applyDelayMs(appliedFilters, filters);
    const timer = setTimeout(() => {
      setAppliedFilters((current) => (JSON.stringify(current) === JSON.stringify(filters) ? current : { ...filters }));
    }, delay);
    return () => clearTimeout(timer);
  }, [filters, appliedFilters]);

  const rows = useMemo(() => sortForDisplay(data?.transactions ?? [], today), [data, today]);
  const options = data?.options ?? emptyOptions;
  // Com erro de CARGA, nao mostrar o vazio (ha lancamentos, so nao carregaram):
  // a decisao esta na funcao pura listContentState. Erro de acao nao entra aqui.
  const contentState = listContentState({ loading, failed: loadFailed, rowCount: rows.length });

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
    const previousCategoryId = rows.find((row) => row.id === id)?.categoryId;
    setBusy(true);
    try {
      const response = await fetch(`/api/transactions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      await readJson(response, idResponseSchema);
      await load(appliedFilters);
      if (shouldOfferAfterEdit(previousCategoryId, input.categoryId)) await offerRule([id]);
    } finally {
      setBusy(false);
    }
  }

  /**
   * F5: depois de categorizar a mao, pergunta se vira regra. Sem oferta (outra
   * loja no lote, ja coberta por regra, padrao vazio), nao abre nada. Falha da
   * oferta nao desfaz a categorizacao, que ja foi gravada: so avisa.
   */
  async function offerRule(transactionIds: string[]) {
    try {
      const response = await fetch('/api/rules/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true, transactionIds }),
      });
      const { offer } = await readJson(response, ruleOfferResponseSchema);
      if (offer !== null) setDialog({ kind: 'offer', transactionIds, offer });
    } catch (offerError) {
      setError(offerError instanceof Error ? offerError.message : 'Não foi possível sugerir uma regra.');
    }
  }

  /** Recalcula a oferta para o trecho editado no dialogo. */
  const previewOffer = useCallback(async (transactionIds: string[], pattern: string) => {
    const response = await fetch('/api/rules/offer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: true, transactionIds, pattern }),
    });
    return (await readJson(response, ruleOfferResponseSchema)).offer;
  }, []);

  /** Aceite: devolve a mensagem de erro (o dialogo fica aberto) ou null. */
  async function acceptOffer(transactionIds: string[], offer: RuleOffer): Promise<string | null> {
    setBusy(true);
    try {
      const response = await fetch('/api/rules/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false, transactionIds, pattern: offer.pattern, matchingIds: offer.matchingIds }),
      });
      const result = await readJson(response, ruleOfferAcceptedSchema);
      setDialog(null);
      setNotice(ruleOfferAcceptedMessage(result));
      await load(appliedFilters);
      return null;
    } catch (offerError) {
      return offerError instanceof Error ? offerError.message : 'Não foi possível criar a regra.';
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
      const categorized = selectedIds;
      setSelectedIds([]);
      setDialog(null);
      await load(appliedFilters);
      await offerRule(categorized);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Decisão 16a: antes de gravar, pergunta ao servidor se o lançamento cumpre uma previsão.
   * Havendo, a pessoa decide no diálogo seguinte; não havendo, grava direto. O servidor nunca
   * concilia sem o `reconcilePlannedId` que só a resposta "sim" envia.
   *
   * A sugestão é ajuda, não condição: se a procura falhar (rede, servidor), o lançamento é
   * gravado normal, sem conciliar, em vez de travar a entrada manual (D1 do Corvo).
   */
  async function createManual(values: ManualValues) {
    setBusy(true);
    try {
      const response = await fetch('/api/transactions/reconcile-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const { suggestion } = await readJson(response, suggestionResponseSchema);
      if (suggestion !== null) {
        setDialog({ kind: 'reconcile', values, suggestion: { ...suggestion, amountCents: cents(suggestion.amountCents) } });
        return;
      }
    } catch {
      // Sem sugestão: segue para a gravação normal abaixo.
    } finally {
      setBusy(false);
    }
    await saveManual(values, null);
  }

  async function saveManual(values: ManualValues, reconcilePlannedId: string | null) {
    setBusy(true);
    try {
      const response = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, reconcilePlannedId }),
      });
      await readJson(response, idResponseSchema);
      setDialog(null);
      await load(appliedFilters);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Exclui o lançamento. Quem decide o que some é o servidor (o mesmo cálculo da
   * confirmação); a tela só recarrega. Erro volta ao diálogo, que o mostra.
   */
  async function deleteRow(transactionId: string, scope: 'only' | 'with-future') {
    setBusy(true);
    try {
      const response = await fetch(`/api/transactions/${transactionId}?scope=${scope}`, { method: 'DELETE' });
      await readJson(response, deleteResultSchema);
      setDialog(null);
      setSelectedIds((previous) => previous.filter((id) => id !== transactionId));
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
        body: JSON.stringify({ pattern, matchType: 'contains', categoryId, memberId }),
      });
      const created = await readJson(response, idResponseSchema);
      // Oferta logo apos criar (F3): a regra nova so valeria para a proxima
      // importacao; os lancamentos que ela ja reconhece aparecem na previa.
      const preview = await previewRules(created.id);
      if (preview.total === 0) {
        setDialog(null);
        setNotice('Regra criada. Nenhum outro lançamento sem categoria é reconhecido por ela.');
      } else {
        setDialog({
          kind: 'apply',
          title: `A regra reconhece ${String(preview.total)} lançamento${preview.total === 1 ? '' : 's'} sem categoria`,
          preview,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function previewRules(ruleId: string | null): Promise<RuleApplicationPreview> {
    const response = await fetch('/api/rules/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: true, ruleId }),
    });
    return readJson(response, ruleApplicationPreviewSchema);
  }

  async function openApplyAll() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setDialog({ kind: 'apply', title: 'Aplicar regras aos não categorizados', preview: await previewRules(null) });
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'Não foi possível preparar a prévia.');
    } finally {
      setBusy(false);
    }
  }

  async function applyRules(items: { transactionId: string; ruleId: string; categoryId: string }[]) {
    setBusy(true);
    try {
      const response = await fetch('/api/rules/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false, items }),
      });
      const result = await readJson(response, ruleApplicationResultSchema);
      setDialog(null);
      setNotice(applyResultMessage(result));
      await load(appliedFilters);
    } catch (applyError) {
      setDialog(null);
      setError(applyError instanceof Error ? applyError.message : 'Não foi possível aplicar as regras.');
    } finally {
      setBusy(false);
    }
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
  }

  return (
    <>
      <PageHeader
        title="Lançamentos"
        description="Receitas e despesas da família, filtráveis por período, categoria, cartão ou conta, responsável e texto."
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row [&>*]:w-full sm:[&>*]:w-auto">
            {/* Celular: um primário e o resto num menu. Desktop: as três ações à vista. */}
            <details className="relative sm:hidden">
              <summary className="sem-marcador inline-flex min-h-11 cursor-pointer list-none items-center justify-center border border-border px-4 text-sm font-medium hover:bg-muted">Mais ações</summary>
              <div className="mt-1 flex flex-col gap-1 border border-border bg-card p-1">
                <Link href="/lancamentos/revisar" className="inline-flex min-h-11 items-center px-3 text-sm font-medium hover:bg-muted">Revisar sem categoria</Link>
                <button type="button" onClick={() => void openApplyAll()} disabled={busy} className="inline-flex min-h-11 items-center px-3 text-left text-sm font-medium hover:bg-muted disabled:opacity-50">Aplicar regras aos não categorizados</button>
              </div>
            </details>
            <Link href="/lancamentos/revisar" className="hidden min-h-9 items-center justify-center border border-border px-4 text-sm font-medium hover:bg-muted sm:inline-flex">Revisar sem categoria</Link>
            <Button variant="outline" className="hidden sm:inline-flex" onClick={() => void openApplyAll()} disabled={busy}><Wand2 className="mr-2 h-4 w-4" aria-hidden="true" />Aplicar regras aos não categorizados</Button>
            <Button className="order-first sm:order-none" onClick={() => setDialog({ kind: 'manual' })}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />Novo lançamento</Button>
          </div>
        }
      />

      {error ? <div role="alert" className="flex flex-col gap-3 border border-destructive/50 bg-destructive-soft px-4 py-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"><span>{error}</span>{loadFailed ? <Button variant="outline" size="sm" onClick={() => void load(appliedFilters)}>Tentar novamente</Button> : null}</div> : null}

      {notice ? <div role="status" className="flex items-center justify-between gap-3 border border-success/50 bg-success-soft px-4 py-3 text-sm text-success"><span>{notice}</span><Button variant="ghost" size="sm" onClick={() => setNotice(null)}>Fechar</Button></div> : null}

      <TransactionFilters value={filters} options={options} open={filtersOpen} onOpenChange={setFiltersOpen} onChange={(value) => setFilters((previous) => ({ ...previous, ...value }))} onClear={clearFilters} />

      {selectedIds.length > 0 ? (
        <div className="flex flex-col gap-3 border border-primary/30 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium">{selectedIds.length} selecionado{selectedIds.length === 1 ? '' : 's'}</p>
          <Button size="sm" onClick={() => setDialog({ kind: 'batch' })}><Tags className="mr-2 h-4 w-4" aria-hidden="true" />Categorizar selecionados</Button>
        </div>
      ) : null}

      {contentState === 'loading' ? <div className=" border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">Carregando lançamentos…</div> : contentState === 'empty' ? (
        <EmptyState
          title={hasFilters(appliedFilters) ? 'Nenhum lançamento encontrado' : 'Nenhum lançamento ainda'}
          description={hasFilters(appliedFilters) ? 'Ajuste os filtros ou limpe a busca para ver outros lançamentos.' : 'Registre um lançamento manual ou importe uma fatura ou extrato para começar.'}
          action={hasFilters(appliedFilters) ? { label: 'Limpar filtros', onClick: clearFilters } : { label: 'Novo lançamento', onClick: () => setDialog({ kind: 'manual' }) }}
        />
      ) : contentState === 'list' ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{rows.length} lançamento{rows.length === 1 ? '' : 's'} encontrado{rows.length === 1 ? '' : 's'}</p>
          <TransactionList rows={rows} options={options} selectedIds={selectedIds} onToggle={toggleSelection} onToggleAll={toggleAll} onEdit={setEditingId} onRule={openRule} onDelete={(id) => setDialog({ kind: 'delete', transactionId: id })} editingId={editingId} onSaveEdit={saveEdit} onCancelEdit={() => setEditingId(null)} />
        </div>
      ) : null}

      {dialog?.kind === 'manual' ? <ManualTransactionDialog today={today} options={options} busy={busy} initial={dialog.initial} onClose={() => setDialog(null)} onSubmit={createManual} /> : null}
      {dialog?.kind === 'reconcile' ? (
        <ReconcileQuestionDialog
          suggestion={dialog.suggestion}
          busy={busy}
          onBack={() => setDialog({ kind: 'manual', initial: dialog.values })}
          onAnswer={(fulfills) => saveManual(dialog.values, fulfills ? dialog.suggestion.plannedId : null)}
        />
      ) : null}
      {dialog?.kind === 'batch' ? <BatchCategorizationDialog count={selectedIds.length} options={options} busy={busy} onClose={() => setDialog(null)} onSubmit={categorizeBatch} /> : null}
      {dialog?.kind === 'delete' ? (
        (() => {
          const target = rows.find((row) => row.id === dialog.transactionId);
          return target === undefined ? null : (
            <DeleteTransactionDialog
              transaction={target}
              busy={busy}
              onClose={() => setDialog(null)}
              onConfirm={(scope) => deleteRow(target.id, scope)}
            />
          );
        })()
      ) : null}
      {dialog?.kind === 'offer' ? (
        (() => {
          const transactionIds = dialog.transactionIds;
          return (
            <RuleOfferDialog
              initialOffer={dialog.offer}
              busy={busy}
              onClose={() => setDialog(null)}
              onPreview={(pattern) => previewOffer(transactionIds, pattern)}
              onAccept={(offer) => acceptOffer(transactionIds, offer)}
            />
          );
        })()
      ) : null}
      {dialog?.kind === 'apply' ? <ApplyRulesDialog title={dialog.title} proposals={dialog.preview.proposals} total={dialog.preview.total} busy={busy} onClose={() => setDialog(null)} onConfirm={applyRules} /> : null}
      {dialog?.kind === 'rule' ? <RuleDialog suggestion={ruleSuggestion} options={options} busy={busy} loading={loadingRule} onClose={() => setDialog(null)} onSubmit={createRule} /> : null}
    </>
  );
}
