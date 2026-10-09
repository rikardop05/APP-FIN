'use client';

import Link from 'next/link';
import { ChevronLeft, ChevronRight, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';

import { addCompetence, toCompetence } from '@/lib/date';
import { cents, formatBRL, parseBRL } from '@/lib/money';

import {
  Button,
  Canhoto,
  EmptyState,
  Faixa,
  Input,
  Money,
  PageHeader,
} from '@/components/ui-kit';

import { changedCount, monthTotals, saveHint, totalLine } from './totals';
import { buildSaveBody, type BudgetFieldValues } from './save-body';
import { BAR_X_CLASS, barScaleStyle } from '@/components/dashboard/bar-scale';
import { competenceLabel, competenceTitle, EXPECTED_LABEL, expectedUsageText, formatPercent, LIGHT_VIEW, remainingText, rowMarca, toFieldText } from './labels';
import {
  summarizeUncategorized,
  uncategorizedResponseSchema,
  uncategorizedTitle,
  uncategorizedVerb,
  type UncategorizedSummary,
} from './uncategorized';
import {
  apiErrorSchema,
  budgetMonthResponseSchema,
  suggestionResponseSchema,
  type BudgetCategoryView,
  type BudgetMonthResponse,
  type BudgetRowView,
} from './schemas';

type Message = { kind: 'info' | 'success' | 'error'; text: string };

/**
 * Orçamento por categoria — T-205.
 *
 * A tela NÃO calcula: semáforo, uso, restante e sugestão vêm do servidor
 * (`budgetStatus` e `suggestBudgetFromHistory`, CONTRACTS §10). Aqui só se
 * formata, agrupa e ouve o usuário.
 *
 * "Repetir mês anterior" e "Média de 3 meses" são SUGESTÃO: preenchem o
 * formulário e mais nada. Quem grava é a pessoa, ao clicar em Salvar.
 *
 * O semáforo e o realizado são do valor SALVO. Enquanto o campo diverge do
 * salvo, a linha avisa em vez de mostrar uma cor que não corresponde ao que
 * está digitado.
 */
export function BudgetScreen({ today }: { today: string }) {
  const [period, setPeriod] = useState(() => toCompetence(today));
  const [data, setData] = useState<BudgetMonthResponse | null>(null);
  const [fields, setFields] = useState<BudgetFieldValues>({});
  const [baseline, setBaseline] = useState<BudgetFieldValues>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);

  function applyMonth(month: BudgetMonthResponse) {
    const initial: BudgetFieldValues = {};
    const byId = new Map(month.rows.map((row) => [row.categoryId, row] as const));
    for (const category of month.categories) {
      const row = byId.get(category.id);
      initial[category.id] = row === undefined ? '' : toFieldText(row.plannedCents);
    }
    setData(month);
    setFields(initial);
    setBaseline(initial);
    setInvalid(new Set());
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    setMessage(null);
    void fetch(`/api/budgets?period=${period}`, { signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const parsedError = apiErrorSchema.safeParse(body);
          throw new Error(
            parsedError.success ? parsedError.data.error : 'Não foi possível carregar o orçamento.',
          );
        }
        return budgetMonthResponseSchema.parse(body);
      })
      .then((month) => applyMonth(month))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setLoadError(cause instanceof Error ? cause.message : 'Não foi possível carregar o orçamento.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [period, reloadKey]);

  // Despesas sem categoria da competência: ficam fora de TODAS as barras, então a tela diz quanto é.
  const [uncategorized, setUncategorized] = useState<UncategorizedSummary | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setUncategorized(null);
    void fetch('/api/transactions?uncategorized=true', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const parsed = uncategorizedResponseSchema.safeParse(await response.json().catch(() => null));
        if (parsed.success) setUncategorized(summarizeUncategorized(parsed.data.transactions, period));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [period, reloadKey]);

  const dirty = JSON.stringify(fields) !== JSON.stringify(baseline);
  const changed = changedCount(fields, baseline);
  const totals = data === null ? null : monthTotals(data.rows, data.warnBp);

  function setField(categoryId: string, text: string) {
    setFields((current) => ({ ...current, [categoryId]: text }));
    setInvalid((current) => {
      if (!current.has(categoryId)) return current;
      const next = new Set(current);
      next.delete(categoryId);
      return next;
    });
    setMessage(null);
  }

  async function suggest(mode: 'previous' | 'avg3') {
    if (data === null) return;
    setSuggesting(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/budgets/suggestion?period=${period}&mode=${mode}`);
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsedError = apiErrorSchema.safeParse(body);
        throw new Error(
          parsedError.success ? parsedError.data.error : 'Não foi possível calcular a sugestão.',
        );
      }
      const result = suggestionResponseSchema.parse(body);
      const known = new Set(data.categories.map((category) => category.id));
      const applicable = result.suggestions.filter((item) => known.has(item.categoryId));
      const source = mode === 'previous' ? 'mês anterior' : 'média dos últimos 3 meses';
      if (applicable.length === 0) {
        setMessage({
          kind: 'info',
          text:
            mode === 'previous'
              ? `Não há gastos efetivados em ${competenceLabel(addCompetence(period, -1))} para sugerir.`
              : 'Não há gastos efetivados nos 3 meses anteriores para sugerir.',
        });
        return;
      }
      setFields((current) => {
        const next = { ...current };
        for (const item of applicable) next[item.categoryId] = toFieldText(item.suggestedCents);
        return next;
      });
      setInvalid(new Set());
      setMessage({
        kind: 'info',
        text: `${String(applicable.length)} ${applicable.length === 1 ? 'categoria preenchida' : 'categorias preenchidas'} com o ${source}. Revise e salve: nada foi gravado ainda.`,
      });
    } catch (cause) {
      setMessage({
        kind: 'error',
        text: cause instanceof Error ? cause.message : 'Não foi possível calcular a sugestão.',
      });
    } finally {
      setSuggesting(false);
    }
  }

  async function save() {
    if (data === null) return;
    const built = buildSaveBody(period, fields);
    if (!built.ok) {
      setInvalid(new Set(built.invalidCategoryIds));
      const names = data.categories
        .filter((category) => built.invalidCategoryIds.includes(category.id))
        .map((category) => category.name);
      setMessage({
        kind: 'error',
        text: `Valor inválido em: ${names.join(', ')}. Use números como 1.200,50; deixe em branco para não ter orçamento.`,
      });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/budgets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(built.body),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsedError = apiErrorSchema.safeParse(body);
        throw new Error(
          parsedError.success ? parsedError.data.error : 'Não foi possível salvar o orçamento.',
        );
      }
      applyMonth(budgetMonthResponseSchema.parse(body));
      setMessage({ kind: 'success', text: `Orçamento de ${competenceLabel(period)} salvo.` });
    } catch (cause) {
      setMessage({
        kind: 'error',
        text: cause instanceof Error ? cause.message : 'Não foi possível salvar o orçamento.',
      });
    } finally {
      setSaving(false);
    }
  }

  const busy = loading || saving || suggesting;

  const monthNav = (
    <div className="flex items-center gap-1" role="group" aria-label="Mês do orçamento">
      <Button
        variant="outline"
        size="sm"
        aria-label="Mês anterior"
        disabled={busy || dirty}
        onClick={() => setPeriod((current) => addCompetence(current, -1))}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <span className="min-w-36 text-center text-sm font-medium" aria-live="polite">
        {competenceTitle(period)}
      </span>
      <Button
        variant="outline"
        size="sm"
        aria-label="Próximo mês"
        disabled={busy || dirty}
        onClick={() => setPeriod((current) => addCompetence(current, 1))}
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Orçamento"
        description="Quanto cada categoria pode gastar no mês, comparado com o que já foi gasto."
        actions={monthNav}
      />

      <div className="mt-4 flex flex-col gap-4">
        {loadError !== null ? (
          <div
            role="alert"
            className="flex flex-col gap-2 border border-destructive/50 bg-destructive-soft px-3 py-3 text-sm text-foreground"
          >
            <span>{loadError}</span>
            <div>
              <Button variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
                Tentar de novo
              </Button>
            </div>
          </div>
        ) : null}

        {loading && data === null && loadError === null ? (
          <p className="text-sm text-muted-foreground" role="status">
            Carregando o orçamento…
          </p>
        ) : null}

        {data !== null && data.categories.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="Nenhuma subcategoria de despesa"
            description="O orçamento é por subcategoria. Cadastre categorias de despesa em Configurações para definir limites."
            action={{ label: 'Abrir configurações', href: '/config' }}
          />
        ) : null}

        {data !== null && data.categories.length > 0 ? (
          <>
            {uncategorized !== null && uncategorized.count > 0 ? (
              <Faixa tone="attention" role="status">
                <p>
                  {uncategorizedTitle(uncategorized.count)} (<Money value={uncategorized.totalCents} sign="never" />){' '}
                  {uncategorizedVerb(uncategorized.count)}.{' '}
                  <Link href="/lancamentos/revisar" className="font-medium text-primary underline underline-offset-2">
                    Revisar
                  </Link>
                </p>
              </Faixa>
            ) : null}

            {totals !== null ? (
              <section aria-labelledby="budget-total-heading" className="flex flex-col gap-2 border border-border bg-card p-4">
                <h2 id="budget-total-heading" className="text-sm font-medium text-muted-foreground">
                  Total de {competenceLabel(period)}
                </h2>
                {totals.light === null ? (
                  <p className="text-sm text-muted-foreground">Nenhuma categoria de despesa neste mês.</p>
                ) : (
                  <>
                    <p className="flex flex-wrap items-baseline gap-x-2 text-lg font-semibold">
                      {totalLine(totals)}
                      <span className="text-sm font-normal text-muted-foreground">
                        {LIGHT_VIEW[totals.light].label}{totals.usageBp === null ? '' : ` · ${formatPercent(totals.usageBp)}`}
                      </span>
                    </p>
                    <div
                      className="h-2 overflow-hidden bg-secondary"
                      role="img"
                      aria-label={expectedUsageText(totals.usageBp)}
                    >
                      <div
                        className={`${BAR_X_CLASS} ${LIGHT_VIEW[totals.light].bar}`}
                        style={barScaleStyle(totals.usageBp === null ? (totals.expectedCents > 0 ? 100 : 0) : Math.min(100, totals.usageBp / 100), 'x')}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {remainingText(cents(totals.remainingCents))}. Valores salvos.
                    </p>
                  </>
                )}
              </section>
            ) : null}

            <div className="flex flex-col gap-3 border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void suggest('previous')}>
                  Repetir mês anterior
                </Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void suggest('avg3')}>
                  Média de 3 meses
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground" role="status">{saveHint(changed)}</span>
                {dirty ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setFields(baseline);
                      setInvalid(new Set());
                      setMessage(null);
                    }}
                  >
                    Descartar alterações
                  </Button>
                ) : null}
                <Button disabled={busy || !dirty} onClick={() => void save()}>
                  {saving ? 'Salvando…' : 'Salvar orçamento'}
                </Button>
              </div>
            </div>

            {message !== null ? (
              <p
                role={message.kind === 'error' ? 'alert' : 'status'}
                className={
                  message.kind === 'error'
                    ? 'border border-destructive/50 bg-destructive-soft px-3 py-2 text-sm text-foreground'
                    : message.kind === 'success'
                      ? 'border border-success/50 bg-success-soft px-3 py-2 text-sm text-foreground'
                      : 'border border-border bg-muted px-3 py-2 text-sm text-foreground'
                }
              >
                {message.text}
              </p>
            ) : null}

            {dirty && message === null ? (
              <p className="text-xs text-muted-foreground" role="status">
                Alterações não salvas. Para mudar de mês, salve ou descarte.
              </p>
            ) : null}

            <p className="max-w-[65ch] text-xs text-muted-foreground">
              A cor mede o <strong className="font-medium text-foreground">{EXPECTED_LABEL.toLowerCase()}</strong>{' '}
              do mês: o que já foi lançado (<strong className="font-medium text-foreground">realizado</strong>)
              mais as despesas esperadas que ainda não foram lançadas (
              <strong className="font-medium text-foreground">previsto a realizar</strong>). Ela responde
              &ldquo;ainda posso gastar nesta categoria?&rdquo;. A cor muda para amarelo a partir de{' '}
              {formatPercent(data.warnBp)} e para vermelho acima de 100%.
            </p>

            <BudgetGroups
              data={data}
              fields={fields}
              invalid={invalid}
              disabled={busy}
              onChange={setField}
            />
          </>
        ) : null}
      </div>
    </>
  );
}

function BudgetGroups({
  data,
  fields,
  invalid,
  disabled,
  onChange,
}: {
  data: BudgetMonthResponse;
  fields: BudgetFieldValues;
  invalid: ReadonlySet<string>;
  disabled: boolean;
  onChange: (categoryId: string, text: string) => void;
}) {
  const rowById = new Map(data.rows.map((row) => [row.categoryId, row] as const));
  const groups: { rootId: string; rootName: string; items: BudgetCategoryView[] }[] = [];
  for (const category of data.categories) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.rootId === category.rootId) last.items.push(category);
    else groups.push({ rootId: category.rootId, rootName: category.rootName, items: [category] });
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.rootId} aria-labelledby={`grupo-${group.rootId}`} className="flex flex-col gap-2">
          <h2 id={`grupo-${group.rootId}`} className="text-sm font-semibold text-foreground">
            {group.rootName}
          </h2>
          <ul className="flex flex-col gap-2">
            {group.items.map((category) => (
              <li key={category.id}>
                <CategoryRow
                  category={category}
                  row={rowById.get(category.id)}
                  text={fields[category.id] ?? ''}
                  invalid={invalid.has(category.id)}
                  disabled={disabled}
                  onChange={(text) => onChange(category.id, text)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CategoryRow({
  category,
  row,
  text,
  invalid,
  disabled,
  onChange,
}: {
  category: BudgetCategoryView;
  row: BudgetRowView | undefined;
  text: string;
  invalid: boolean;
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  // O semáforo é do valor SALVO: se o campo diverge, a cor não corresponde ao digitado.
  const typed = text.trim() === '' ? null : parseBRL(text);
  const stale = row !== undefined && typed !== row.plannedCents;
  const inputId = `orcamento-${category.id}`;
  // O talão é UM número: o uso do orçamento, sem casas. Sem orçamento salvo, traço.
  const usage = row !== undefined && !stale && row.usageBp !== null ? formatPercent(row.usageBp) : '—';

  return (
    <Canhoto
      as="div"
      stub={usage}
      // Selo e letra só para o que pede atenção (perto do limite, estourou); dentro do limite não leva selo.
      marca={row === undefined || stale ? undefined : (rowMarca(row.light) ?? undefined)}
      valor={
        <div className="flex w-full flex-col gap-1 sm:w-44">
          <div className="relative">
            <span
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
              aria-hidden="true"
            >
              R$
            </span>
            <Input
              id={inputId}
              value={text}
              inputMode="decimal"
              placeholder="Sem orçamento"
              aria-label={`Orçamento de ${category.name}`}
              aria-invalid={invalid}
              disabled={disabled}
              className={`pl-9 text-right num ${invalid ? 'border-destructive' : ''}`}
              onChange={(event) => onChange(event.target.value)}
            />
          </div>
          {invalid ? (
            <span className="text-xs text-destructive" role="alert">
              Valor inválido.
            </span>
          ) : null}
        </div>
      }
    >
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">
        {category.name}
      </label>
      {row === undefined ? (
        <p className="text-sm text-muted-foreground">
          {typed === null ? 'Sem orçamento definido.' : 'Salve para ver o realizado desta categoria.'}
        </p>
      ) : stale ? (
        <p className="text-sm text-muted-foreground">Valor alterado: salve para atualizar o realizado e a cor.</p>
      ) : (
        <div className="flex flex-col gap-1 text-sm">
          {/* Um número por conceito: gasto esperado aqui, orçado no campo, restante abaixo. A divisão em
              realizado e previsto fica na dica e para leitor de tela, não como terceira versão do número. */}
          <p className="flex flex-wrap items-baseline gap-x-2" title={`Realizado ${formatBRL(row.spentCents, { sign: 'never' })} + previsto ${formatBRL(row.upcomingCents, { sign: 'never' })}`}>
            <span className="text-muted-foreground">Gasto esperado</span>
            <Money value={row.expectedCents} sign="never" className="font-medium text-foreground" />
            <span className="sr-only">
              , realizado {formatBRL(row.spentCents, { sign: 'never' })} mais previsto{' '}
              {formatBRL(row.upcomingCents, { sign: 'never' })}
            </span>
          </p>
          {row.usageBp !== null ? (
            <div className="h-1.5 overflow-hidden bg-secondary" role="img" aria-label={expectedUsageText(row.usageBp)}>
              <div
                className={`${BAR_X_CLASS} ${LIGHT_VIEW[row.light].bar}`}
                style={barScaleStyle(row.usageBp / 100, 'x')}
              />
            </div>
          ) : (
            <p className="text-muted-foreground">Orçamento zero.</p>
          )}
          <p className={`text-xs ${row.remainingCents < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
            {remainingText(row.remainingCents)}
          </p>
        </div>
      )}
    </Canhoto>
  );
}
