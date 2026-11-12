'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { toCompetence } from '@/lib/date';
import { cents } from '@/lib/money';
import { ChevronLeft, ChevronRight, Plus, Tags, Wand2 } from 'lucide-react';
import { competenceLong } from '@/components/cashflow/labels';
import { Button, EmptyState, LoadingBlock, Money, MonthPicker, Picote, SeloLegend, ShortcutLegend } from '@/components/ui-kit';
import { TransactionFilters } from './transaction-filters';
import { applyDelayMs, EMPTY_FILTERS, hasActiveFilters, type TransactionFilterValues } from './filter-presentation';
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
import { matchesSettlement, pruneSelection } from './payment-situation';
import {
  ALL_MONTHS,
  competenceParam,
  countLabel,
  reviewLabel,
  shiftMonth,
  surplusLabel,
  toggleAllMonths,
  viewHref,
  type InitialView,
  type MonthView,
} from './month-view';

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

/**
 * A consulta que os filtros pedem. O mês (`competence`) entra à parte: é navegação, não filtro, e a
 * comparação "os filtros mudaram?" (`queryString(current) === queryString(filters)`) não depende dele.
 */
function queryString(filters: TransactionFilterValues, month: MonthView = ALL_MONTHS): string {
  const params = new URLSearchParams();
  const competence = competenceParam(month);
  if (competence !== undefined) params.set('competence', competence);
  if (filters.direction) params.set('direction', filters.direction);
  if (filters.origin) params.set('origin', filters.origin);
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

/**
 * Lançamentos por mês (Lote 2, itens 5 a 7).
 *
 * `initial` vem da URL, lida no servidor (`initialView`): o mês (`?mes=`) e o deep link do Painel
 * (`?semCategoria=1`, que abre em todos os meses já filtrado). Assim a primeira consulta já é a certa, sem
 * depender de `window` na montagem.
 *
 * A tela NÃO soma dinheiro: Receitas, Despesas e Sobra vêm de `summary` (o `monthlyKpis` do Painel, do mês
 * inteiro) e a contagem do botão "Revisar N sem categoria" vem de `uncategorizedCount` (do household).
 */
export function LancamentosScreen({ today, initial }: { today: string; initial: InitialView }) {
  const initialFilters = useMemo(
    () => (initial.uncategorized ? { ...EMPTY_FILTERS, uncategorized: true } : EMPTY_FILTERS),
    [initial.uncategorized],
  );
  const [month, setMonth] = useState<MonthView>(initial.month);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  // Vindo do deep link do Painel, o painel de filtros abre à vista (o filtro "não categorizados" mora nele).
  const [filtersOpen, setFiltersOpen] = useState(initial.uncategorized);
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
  /** O deep link `?aplicarRegras=1` so tenta abrir a prévia UMA vez (F5 nao reabre). */
  const [autoApplyOpened, setAutoApplyOpened] = useState(false);

  const load = useCallback(async (nextFilters: TransactionFilterValues) => {
    setLoading(true);
    setError(null);
    setLoadFailed(false);
    try {
      const response = await fetch(`/api/transactions${queryString(nextFilters, month)}`, { cache: 'no-store' });
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
  }, [month]);

  // Recarrega quando os filtros aplicados OU o mês mudam (`load` depende do mês).
  useEffect(() => { void load(appliedFilters); }, [appliedFilters, load]);

  /** Troca o mês e põe a escolha na URL (`?mes=`), sem navegação: o F5 e o link copiado abrem o mesmo mês. */
  function changeMonth(next: MonthView) {
    if (next === month) return;
    setMonth(next);
    window.history.replaceState(null, '', viewHref(next, today, { uncategorized: filters.uncategorized }));
  }

  // Filtros aplicam sozinhos: campos discretos na hora, texto com atraso curto (sem botao Filtrar).
  useEffect(() => {
    const delay = applyDelayMs(appliedFilters, filters);
    const timer = setTimeout(() => {
      // O filtro Situacao e so da tela: comparar pela consulta, para trocar de situacao NAO refazer o fetch.
      setAppliedFilters((current) => (queryString(current) === queryString(filters) ? current : { ...filters }));
    }, delay);
    return () => clearTimeout(timer);
  }, [filters, appliedFilters]);

  // O filtro Situação é só da tela (a linha já traz a situação da fatura): vale na hora, sem nova consulta.
  const rows = useMemo(
    () => sortForDisplay(data?.transactions ?? [], today).filter((row) => matchesSettlement(row, filters.settlement)),
    [data, today, filters.settlement],
  );
  const options = data?.options ?? emptyOptions;
  // Nunca aplicar lote em linha escondida: o que o filtro esconde sai da selecao.
  useEffect(() => {
    setSelectedIds((previous) => {
      const kept = pruneSelection(previous, rows);
      return kept.length === previous.length ? previous : kept;
    });
  }, [rows]);
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

  /** Recalcula a oferta para o trecho editado no dialogo. */  const previewOffer = useCallback(async (transactionIds: string[], pattern: string) => {
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

  const previewRules = useCallback(async (ruleId: string | null): Promise<RuleApplicationPreview> => {
    const response = await fetch('/api/rules/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: true, ruleId }),
    });
    return readJson(response, ruleApplicationPreviewSchema);
  }, []);

  const openApplyAll = useCallback(async () => {
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
  }, [previewRules]);

  /**
   * Deep link da aba Regras do Config (`/lancamentos?aplicarRegras=1`): depois da carga inicial
   * bem-sucedida, abre a prévia de "Aplicar regras aos não categorizados" uma vez e consome o
   * param — nada de o F5 reabrir o diálogo. Com erro de carga não dispara (o alerta pede
   * "Tentar novamente", e a recarga não reabre).
   */
  useEffect(() => {
    if (loading || autoApplyOpened) return;
    setAutoApplyOpened(true);
    if (loadFailed) return;
    if (new URLSearchParams(window.location.search).get('aplicarRegras') !== '1') return;
    window.history.replaceState(null, '', viewHref(month, today));
    void openApplyAll();
  }, [loading, loadFailed, autoApplyOpened, openApplyAll, month, today]);

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
    // A URL acompanha o estado: o deep link ?semCategoria=1 morre ao limpar (F5 não traz de volta); o mês fica.
    window.history.replaceState(null, '', viewHref(month, today));
  }

  const filtered = hasActiveFilters(filters);
  // O resumo é do mês INTEIRO (motor do Painel). Com filtro ativo ele some: mostrar o mês inteiro sobre uma
  // lista filtrada pareceria o total do filtro.
  const summary = !filtered && data !== null && data.summary !== null && data.summary.competence === month ? data.summary : null;
  // Do household, não do filtro: sem pendência, o botão de revisão não existe (nem em "Mais ações").
  const review = reviewLabel(data?.uncategorizedCount ?? 0);
  const monthName = month === ALL_MONTHS ? null : competenceLong(month);

  return (
    <>
      {/*
        Cabeçalho próprio (não o PageHeader): no celular a descrição some e as ações ficam numa linha só
        ("Novo lançamento" e "Mais ações"), para a lista começar mais cedo (Lote 2, item 6).
      */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Lançamentos</h1>
            <p className="hidden text-sm text-muted-foreground sm:block">
              Receitas e despesas da família, mês a mês, filtráveis por tipo, origem, responsável e texto.
            </p>
          </div>
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
            <Button className="min-w-0 flex-1 sm:flex-none" onClick={() => setDialog({ kind: 'manual' })}>
              <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
              Novo lançamento
            </Button>
            {/* Celular: o resto das ações num menu que abre POR CIMA da tela (não empurra a lista). */}
            <details className="relative shrink-0 sm:hidden">
              <summary className="sem-marcador inline-flex h-11 cursor-pointer list-none items-center justify-center border border-input bg-card px-4 text-sm font-medium hover:bg-secondary/60">
                Mais ações
              </summary>
              <div className="absolute right-0 top-full z-30 mt-1 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-1 border border-border bg-card p-1 shadow-lg">
                {review !== null ? (
                  <Link href="/lancamentos/revisar" className="inline-flex min-h-11 items-center px-3 text-sm font-medium hover:bg-muted">
                    {review}
                  </Link>
                ) : null}
                <button type="button" onClick={() => void openApplyAll()} disabled={busy} className="inline-flex min-h-11 items-center px-3 text-left text-sm font-medium hover:bg-muted disabled:opacity-50">
                  Aplicar regras aos não categorizados
                </button>
              </div>
            </details>
            {review !== null ? (
              <Link
                href="/lancamentos/revisar"
                className="hidden h-9 items-center justify-center border border-input bg-card px-4 text-sm font-medium hover:bg-secondary/60 sm:inline-flex"
              >
                {review}
              </Link>
            ) : null}
            <Button variant="outline" className="hidden sm:inline-flex" onClick={() => void openApplyAll()} disabled={busy}>
              <Wand2 className="h-4 w-4" aria-hidden="true" />
              Aplicar regras aos não categorizados
            </Button>
          </div>
        </div>
        <Picote />
      </header>

      {/* Navegação de mês: ‹ mês e ano ›. "Todos os meses" fica aqui a partir de `sm`; no celular, na fila dos filtros rápidos. */}
      <div className="flex items-center gap-2" role="group" aria-label="Mês dos lançamentos">
        <Button variant="outline" size="sm" aria-label="Mês anterior" disabled={month === ALL_MONTHS} onClick={() => changeMonth(shiftMonth(month, -1))}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <MonthPicker
          label="Mês dos lançamentos"
          value={month === ALL_MONTHS ? '' : month}
          centerYear={Number(toCompetence(today).slice(0, 4))}
          className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,6rem)] gap-2 sm:max-w-xs"
          onChange={(value) => changeMonth(value)}
        />
        <Button variant="outline" size="sm" aria-label="Próximo mês" disabled={month === ALL_MONTHS} onClick={() => changeMonth(shiftMonth(month, 1))}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          variant={month === ALL_MONTHS ? 'primary' : 'outline'}
          size="sm"
          className="hidden sm:inline-flex"
          aria-pressed={month === ALL_MONTHS}
          onClick={() => changeMonth(toggleAllMonths(month, today))}
        >
          Todos os meses
        </Button>
      </div>

      {/* Resumo do mês: três números do motor do Painel (`monthlyKpis`), sempre do mês inteiro. */}
      {summary !== null && monthName !== null ? (
        <section aria-label={`Resumo de ${monthName}`} className="flex flex-col gap-1 border border-border bg-card px-3 py-2">
          <dl className="grid grid-cols-3 gap-x-3">
            <div className="flex min-w-0 flex-col">
              <dt className="text-xs text-muted-foreground">Receitas</dt>
              <dd><Money value={summary.incomeCents} sign="never" className="text-base font-semibold text-foreground sm:text-lg" /></dd>
            </div>
            <div className="flex min-w-0 flex-col">
              <dt className="text-xs text-muted-foreground">Despesas</dt>
              <dd><Money value={summary.expenseCents} sign="never" className="text-base font-semibold text-foreground sm:text-lg" /></dd>
            </div>
            <div className="flex min-w-0 flex-col">
              <dt className="text-xs text-muted-foreground">{surplusLabel(summary.surplusCents)}</dt>
              <dd><Money value={summary.surplusCents} className="text-base font-semibold text-foreground sm:text-lg" /></dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            Mês inteiro, lançado e previsto<span className="hidden sm:inline">, como no Painel. Aporte, transferência e pagamento de fatura ficam fora</span>.
          </p>
        </section>
      ) : null}

      {error ? <div role="alert" className="flex flex-col gap-3 border border-destructive/50 bg-destructive-soft px-4 py-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"><span>{error}</span>{loadFailed ? <Button variant="outline" size="sm" onClick={() => void load(appliedFilters)}>Tentar novamente</Button> : null}</div> : null}

      {notice ? <div role="status" className="flex items-center justify-between gap-3 border border-success/50 bg-success-soft px-4 py-3 text-sm text-success"><span>{notice}</span><Button variant="ghost" size="sm" onClick={() => setNotice(null)}>Fechar</Button></div> : null}

      <TransactionFilters
        value={filters}
        options={options}
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        onChange={(value) => setFilters((previous) => ({ ...previous, ...value }))}
        onClear={clearFilters}
        allMonths={{ pressed: month === ALL_MONTHS, onToggle: () => changeMonth(toggleAllMonths(month, today)) }}
      />

      {selectedIds.length > 0 ? (
        <div className="flex flex-col gap-3 border border-primary/30 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium">{selectedIds.length} selecionado{selectedIds.length === 1 ? '' : 's'}</p>
          <Button size="sm" onClick={() => setDialog({ kind: 'batch' })}><Tags className="mr-2 h-4 w-4" aria-hidden="true" />Categorizar selecionados</Button>
        </div>
      ) : null}

      <LoadingBlock
        loading={contentState === 'loading'}
        endText={contentState === 'list' ? 'Lançamentos carregados.' : null}
        label="Carregando lançamentos…"
        count={4}
        retry={() => void load(appliedFilters)}
        // Sem carregar nem falhar o bloco só guarda o aviso para leitor de tela: fora do fluxo, para não
        // deixar um vão (o `gap` do pai) entre a busca e a lista.
        className={contentState === 'loading' || contentState === 'error' ? undefined : 'absolute'}
      />

      {contentState === 'empty' ? (
        <EmptyState
          title={
            hasActiveFilters(filters)
              ? 'Nenhum lançamento encontrado'
              : monthName !== null
                ? `Nenhum lançamento em ${monthName}`
                : 'Nenhum lançamento ainda'
          }
          description={
            hasActiveFilters(filters)
              ? `Ajuste os filtros ou limpe a busca para ver outros lançamentos${monthName !== null ? ` de ${monthName}` : ''}.`
              : monthName !== null
                ? 'Use ‹ e › para ver outro mês, ou "Todos os meses". Você também pode registrar um lançamento ou importar uma fatura.'
                : 'Registre um lançamento manual ou importe uma fatura ou extrato para começar.'
          }
          action={hasActiveFilters(filters) ? { label: 'Limpar filtros', onClick: clearFilters } : { label: 'Novo lançamento', onClick: () => setDialog({ kind: 'manual' }) }}
        />
      ) : contentState === 'list' ? (
        <div className="flex flex-col gap-3">
          {/* Com filtro ativo o resumo do mês some; fica só a contagem, dizendo que é do filtro. */}
          {filtered ? (
            <p className="text-sm text-muted-foreground">
              {countLabel(rows.length)} com os filtros atuais. Receitas, despesas e sobra do mês aparecem sem filtro.
            </p>
          ) : null}
          <TransactionList rows={rows} today={today} settlement={data?.settlement ?? []} options={options} selectedIds={selectedIds} onToggle={toggleSelection} onToggleAll={toggleAll} onEdit={setEditingId} onRule={openRule} onDelete={(id) => setDialog({ kind: 'delete', transactionId: id })} editingId={editingId} onSaveEdit={saveEdit} onCancelEdit={() => setEditingId(null)} />
        </div>
      ) : null}

      {/* Legenda e atalhos (impeccable clarify): o extenso lidera; a letra vira apoio. */}
      <div className="flex items-start gap-x-6 gap-y-1 border-t border-border pt-1">
        <SeloLegend estados={['Previsto', 'Não categorizado']} />
        {/* J e K são do teclado: em toque (`pointer: coarse`) a legenda de atalhos não aparece. */}
        <div className="[@media(pointer:coarse)]:hidden">
        <ShortcutLegend
          atalhos={[
            {
              keys: (
                <kbd className="num border border-border bg-card px-1">J</kbd>
              ),
              label: 'próxima linha',
            },
            {
              keys: (
                <kbd className="num border border-border bg-card px-1">K</kbd>
              ),
              label: 'linha anterior',
            },
          ]}
        />
        </div>
      </div>

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
