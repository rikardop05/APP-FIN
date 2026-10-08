'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { cents, formatBRL, parseBRL } from '@/lib/money';
import { competenceLabel } from '@/components/budget/labels';
import { isSimpleDelete, reimportNotice, reopensPlannedNotice, withFutureOptionLabel } from './delete-presentation';
import { amountForInput, signedAmountCents } from './manual-sign';
import { RECONCILE_EXPLANATION, reconcileQuestion, type ReconcileSuggestion } from './reconcile-question';
import { Button, DateText, Input, Money, Select } from '@/components/ui-kit';
import {
  deleteImpactSchema,
  type DeleteEffect,
  type DeleteImpact,
  type RuleSuggestion,
  type Transaction,
  type TransactionOptions,
} from './schemas';

export function DialogShell({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/20 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-lg border border-border bg-background p-4 shadow-lg sm:max-w-2xl sm:rounded-lg sm:p-6" role="dialog" aria-modal="true" aria-labelledby="transaction-dialog-title">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="transaction-dialog-title" className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <Button variant="ghost" size="sm" aria-label="Fechar" onClick={onClose}>Fechar</Button>
        </div>
        {children}
      </div>
    </div>
  );
}

type ManualValues = {
  occurredOn: string;
  description: string;
  amountCents: number;
  kind: 'expense' | 'income' | 'transfer' | 'credit_card_payment' | 'investment_contribution';
  categoryId: string | null;
  accountId: string | null;
  creditCardId: string | null;
  memberId: string | null;
  note: string | null;
};

function readTransactionKind(value: string): ManualValues['kind'] {
  if (value === 'income') return 'income';
  if (value === 'transfer') return 'transfer';
  if (value === 'credit_card_payment') return 'credit_card_payment';
  if (value === 'investment_contribution') return 'investment_contribution';
  return 'expense';
}

/**
 * Decisão 16a: o lançamento manual combina com uma previsão de recorrência. A pessoa decide:
 * "cumpre" (a previsão vira cumprida e o valor conta uma vez) ou "à parte" (grava normal).
 * Voltar (ou fechar) reabre o formulário com o que foi digitado, sem gravar nada.
 */
export function ReconcileQuestionDialog({
  suggestion,
  busy,
  onBack,
  onAnswer,
}: {
  suggestion: ReconcileSuggestion;
  busy: boolean;
  onBack: () => void;
  onAnswer: (fulfills: boolean) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  async function answer(fulfills: boolean) {
    setError(null);
    try {
      await onAnswer(fulfills);
    } catch (answerError) {
      setError(answerError instanceof Error ? answerError.message : 'Não foi possível criar o lançamento.');
    }
  }
  return (
    <DialogShell title="Este lançamento cumpre uma previsão?" description={RECONCILE_EXPLANATION} onClose={onBack}>
      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium text-foreground">{reconcileQuestion(suggestion)}</p>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>Voltar ao formulário</Button>
          <Button type="button" variant="outline" onClick={() => void answer(false)} disabled={busy}>Não, lançar à parte</Button>
          <Button type="button" onClick={() => void answer(true)} disabled={busy}>{busy ? 'Gravando…' : 'Sim, cumpre'}</Button>
        </div>
      </div>
    </DialogShell>
  );
}

export function ManualTransactionDialog({
  today,
  options,
  busy,
  initial,
  onClose,
  onSubmit,
}: {
  today: string;
  options: TransactionOptions;
  busy: boolean;
  /** O que já foi digitado (volta da pergunta de previsão, decisão 16a). */
  initial?: ManualValues;
  onClose: () => void;
  onSubmit: (values: ManualValues) => Promise<void>;
}) {
  const [occurredOn, setOccurredOn] = useState(initial?.occurredOn ?? today);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [amount, setAmount] = useState(initial ? formatBRL(amountForInput(cents(initial.amountCents), initial.kind)) : '');
  const [kind, setKind] = useState<ManualValues['kind']>(initial?.kind ?? 'expense');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [memberId, setMemberId] = useState(initial?.memberId ?? '');
  const [accountId, setAccountId] = useState(initial ? (initial.accountId ?? '') : (options.accounts[0]?.id ?? ''));
  const [creditCardId, setCreditCardId] = useState(initial?.creditCardId ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  // Despesa e Receita: o sinal vem do tipo, entao o valor e digitado positivo e
  // a dica antiga de "saida negativa" sai (decisao do Ricardo, 2026-10-02).
  const positiveAmount = kind === 'expense' || kind === 'income';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedAmount = parseBRL(amount);
    if (parsedAmount === null) {
      setError('Informe um valor válido.');
      return;
    }
    const amountCents = signedAmountCents(parsedAmount, kind);
    if (!accountId && !creditCardId) {
      setError('Selecione uma conta ou um cartão.');
      return;
    }
    setError(null);
    try {
      await onSubmit({
        occurredOn,
        description: description.trim(),
        amountCents,
        kind,
        categoryId: categoryId || null,
        accountId: accountId || null,
        creditCardId: creditCardId || null,
        memberId: memberId || null,
        note: note.trim() || null,
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Não foi possível criar o lançamento.');
    }
  }

  return (
    <DialogShell title="Novo lançamento" description="Registre uma receita, despesa ou transferência manualmente." onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm"><span className="text-xs text-muted-foreground">Data</span><Input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} required /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-xs text-muted-foreground">Tipo</span><Select value={kind} onChange={(event) => setKind(readTransactionKind(event.target.value))}><option value="expense">Despesa</option><option value="income">Receita</option><option value="transfer">Transferência</option><option value="credit_card_payment">Pagamento de fatura</option><option value="investment_contribution">Aporte</option></Select></label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2"><span className="text-xs text-muted-foreground">Descrição</span><Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ex.: Mercado" maxLength={240} required /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-xs text-muted-foreground">Valor</span><Input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={positiveAmount ? 'R$ 0,00' : '-R$ 0,00'} inputMode="decimal" required />{positiveAmount ? null : <span className="text-xs text-muted-foreground">Use valor negativo para saída.</span>}</label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-xs text-muted-foreground">Conta</span><Select value={accountId} onChange={(event) => { setAccountId(event.target.value); setCreditCardId(''); }}><option value="">Selecionar depois</option>{options.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-xs text-muted-foreground">Cartão</span><Select value={creditCardId} onChange={(event) => { setCreditCardId(event.target.value); setAccountId(''); }}><option value="">Selecionar depois</option>{options.cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}</Select></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-xs text-muted-foreground">Categoria</span><Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Não categorizado</option>{options.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-xs text-muted-foreground">Responsável</span><Select value={memberId} onChange={(event) => setMemberId(event.target.value)}><option value="">Sem responsável</option>{options.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</Select></label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2"><span className="text-xs text-muted-foreground">Observação</span><Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} /></label>
        </div>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? 'Criando…' : 'Criar lançamento'}</Button></div>
      </form>
    </DialogShell>
  );
}

export function BatchCategorizationDialog({
  count,
  options,
  busy,
  onClose,
  onSubmit,
}: {
  count: number;
  options: TransactionOptions;
  busy: boolean;
  onClose: () => void;
  onSubmit: (categoryId: string, memberId: string | null) => Promise<void>;
}) {
  const [categoryId, setCategoryId] = useState('');
  const [memberId, setMemberId] = useState('');
  return (
    <DialogShell title="Categorizar lançamentos" description={`A mesma categoria será aplicada aos ${count} lançamentos selecionados.`} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void onSubmit(categoryId, memberId || null); }}>
        <label className="flex flex-col gap-1 text-sm"><span className="text-xs text-muted-foreground">Categoria</span><Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required><option value="">Selecione uma categoria</option>{options.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-xs text-muted-foreground">Responsável (opcional)</span><Select value={memberId} onChange={(event) => setMemberId(event.target.value)}><option value="">Manter sem responsável</option>{options.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</Select></label>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button><Button type="submit" disabled={busy || !categoryId}>{busy ? 'Aplicando…' : 'Categorizar selecionados'}</Button></div>
      </form>
    </DialogShell>
  );
}

export function RuleDialog({
  suggestion,
  options,
  busy,
  loading,
  onClose,
  onSubmit,
}: {
  suggestion: RuleSuggestion | null;
  options: TransactionOptions;
  busy: boolean;
  loading: boolean;
  onClose: () => void;
  onSubmit: (pattern: string, categoryId: string, memberId: string | null) => Promise<void>;
}) {
  const [pattern, setPattern] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [memberId, setMemberId] = useState('');

  useEffect(() => {
    if (!suggestion) return;
    setPattern(suggestion.suggestion.pattern);
    setCategoryId(suggestion.categoryId ?? '');
    setMemberId(suggestion.memberId ?? '');
  }, [suggestion]);

  return (
    <DialogShell title="Criar regra" description="A sugestão usa o mesmo padrão que o motor de categorização aplica nos lançamentos." onClose={onClose}>
      {loading ? <p className="text-sm text-muted-foreground">Preparando sugestão…</p> : (
        <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void onSubmit(pattern, categoryId, memberId || null); }}>
          <label className="flex flex-col gap-1 text-sm"><span className="text-xs text-muted-foreground">Padrão sugerido</span><Input value={pattern} onChange={(event) => setPattern(event.target.value)} required /><span className="text-xs text-muted-foreground">A regra será do tipo contém e pode ser editada antes de salvar.</span></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-xs text-muted-foreground">Categoria</span><Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required><option value="">Selecione uma categoria</option>{options.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-xs text-muted-foreground">Responsável (opcional)</span><Select value={memberId} onChange={(event) => setMemberId(event.target.value)}><option value="">Sem responsável</option>{options.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</Select></label>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button><Button type="submit" disabled={busy || !pattern || !categoryId}>{busy ? 'Criando…' : 'Criar regra'}</Button></div>
        </form>
      )}
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// Exclusão de lançamento
// ---------------------------------------------------------------------------

type DeleteScope = 'only' | 'with-future';

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** Uma frase por efeito. A tela só FORMATA o que o servidor calculou. */
function EffectLine({ effect }: { effect: DeleteEffect }) {
  switch (effect.kind) {
    case 'plan_hole':
      return (
        <>
          Fica um buraco no plano &ldquo;{effect.planDescription}&rdquo;:{' '}
          {effect.remaining === 1 ? 'sobra 1 lançamento' : `sobram ${String(effect.remaining)} lançamentos`} dele.
        </>
      );
    case 'plan_removed':
      return <>O plano &ldquo;{effect.planDescription}&rdquo; deixa de existir: não sobra nenhuma parcela.</>;
    case 'statement_total':
      return (
        <>
          O total calculado da fatura de {effect.cardName} de {competenceLabel(effect.competence)} vai de{' '}
          <Money value={effect.beforeCents} /> para <Money value={effect.afterCents} />.
          {effect.reportedCents !== null ? (
            <>
              {' '}
              O total impresso na fatura (<Money value={effect.reportedCents} />) não muda; se os dois divergirem, a fatura passa a mostrar divergência.
            </>
          ) : null}
        </>
      );
    case 'statement_unpaid':
      return <>A fatura de {effect.cardName} de {competenceLabel(effect.competence)} volta a constar como não paga.</>;
    case 'import_batch':
      return (
        <>
          O lote &ldquo;{effect.fileName}&rdquo; passa de {plural(effect.before, 'lançamento', 'lançamentos')} para{' '}
          {effect.after}.
        </>
      );
    case 'returns_on_reimport':
    case 'reimport_will_fail':
    case 'stays_deleted_on_reimport':
      return <>{reimportNotice(effect)}</>;
    case 'occurrence_skipped':
      return (
        <>
          Só esta ocorrência de &ldquo;{effect.ruleDescription}&rdquo; ({competenceLabel(effect.competence)}) deixa de ser esperada; as outras continuam.
        </>
      );
    case 'reopens_planned':
      return <>{reopensPlannedNotice(effect)}</>;
    default: {
      // Exaustividade: um efeito novo sem case quebra o `tsc` aqui, em vez de
      // nao renderizar nada e sumir calado da tela.
      const unhandled: never = effect;
      return unhandled;
    }
  }
}

/**
 * Confirmação de exclusão. DUAS apresentações da MESMA resposta de
 * `GET /api/transactions/[id]/delete-impact`:
 *
 * - **Simples** quando `effects` sai vazia e nenhuma parcela futura vai junto: a
 *   exclusão alcança só a linha. Um aviso curto de que vai sumir.
 * - **Detalhada** quando a exclusão alcança ALÉM da linha (parcela de plano, linha
 *   de fatura, linha que volta na reimportação, previsão de recorrência,
 *   pagamento de fatura): o número do que some e só os efeitos que existem.
 *
 * O critério é a lista de efeitos, não o tipo do lançamento: se um lançamento
 * manual um dia ganhar efeito colateral, passa a mostrar o diálogo cheio sozinho.
 * "Isto não pode ser desfeito" aparece nas duas: o app não tem desfazer.
 */
export function DeleteTransactionDialog({
  transaction,
  busy,
  onClose,
  onConfirm,
}: {
  transaction: Transaction;
  busy: boolean;
  onClose: () => void;
  onConfirm: (scope: DeleteScope) => Promise<void>;
}) {
  const isInstallment = transaction.installmentNumber !== null;
  const [scope, setScope] = useState<DeleteScope>('only');
  const [impacts, setImpacts] = useState<{ only: DeleteImpact | null; withFuture: DeleteImpact | null }>({
    only: null,
    withFuture: null,
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load(next: DeleteScope): Promise<DeleteImpact> {
      const response = await fetch(`/api/transactions/${transaction.id}/delete-impact?scope=${next}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
            ? body.error
            : 'Não foi possível calcular o que será excluído.',
        );
      }
      return deleteImpactSchema.parse(body);
    }
    // Parcela: busca os dois escopos para o rótulo "esta e as N futuras" ter número.
    void Promise.all([load('only'), isInstallment ? load('with-future') : Promise.resolve(null)])
      .then(([only, withFuture]) => setImpacts({ only, withFuture }))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setLoadError(cause instanceof Error ? cause.message : 'Não foi possível calcular o que será excluído.');
      });
    return () => controller.abort();
  }, [transaction.id, isInstallment]);

  const impact = scope === 'with-future' ? impacts.withFuture : impacts.only;
  const simple = impact !== null && isSimpleDelete(impact);
  // `null` quando não há futura (ex.: a 12/12): a escolha some, as duas opções seriam iguais.
  const withFutureLabel = withFutureOptionLabel(impacts.withFuture?.deleted.futureInstallments ?? 0);

  async function confirm() {
    setError(null);
    try {
      await onConfirm(scope);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível excluir o lançamento.');
    }
  }

  const heading = (
    <>
      <strong className="font-medium">{transaction.description}</strong> (<Money value={transaction.amountCents} />,{' '}
      <DateText value={transaction.occurredOn} />)
    </>
  );

  return (
    <DialogShell
      title={simple ? 'Excluir lançamento?' : `Excluir "${transaction.description}"?`}
      description={simple ? 'Esta exclusão não mexe em mais nada.' : 'Veja o que esta exclusão alcança antes de confirmar.'}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4 text-sm">
        {loadError !== null ? (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-900">
            {loadError} Por segurança, a exclusão fica bloqueada: não dá para dizer o que ela apagaria.
          </p>
        ) : null}

        {loadError === null && impact === null ? (
          <p role="status" className="text-muted-foreground">Calculando o que será excluído…</p>
        ) : null}

        {impact !== null && simple ? (
          <p>
            {heading} vai sumir.
          </p>
        ) : null}

        {impact !== null && !simple ? (
          <div className="flex flex-col gap-3">
            {isInstallment && withFutureLabel !== null ? (
              <fieldset className="flex flex-col gap-2" disabled={busy}>
                <legend className="mb-1 text-xs text-muted-foreground">Parcela do plano {impact.target.description}</legend>
                <label className="flex items-start gap-2">
                  <input type="radio" name="delete-scope" checked={scope === 'only'} onChange={() => setScope('only')} className="mt-1" />
                  <span>Só esta parcela</span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="radio" name="delete-scope" checked={scope === 'with-future'} onChange={() => setScope('with-future')} className="mt-1" />
                  <span>{withFutureLabel}</span>
                </label>
              </fieldset>
            ) : null}

            <p>
              {heading}. Isto apaga <strong>{plural(impact.deleted.transactions, 'lançamento', 'lançamentos')}</strong>
              {impact.deleted.futureInstallments > 0 ? (
                <>
                  {' '}e <strong>{plural(impact.deleted.futureInstallments, 'parcela futura', 'parcelas futuras')}</strong>
                </>
              ) : null}
              .
            </p>
            {impact.effects.length > 0 ? (
              <ul className="flex list-disc flex-col gap-1.5 pl-5">
                {impact.effects.map((effect, index) => (
                  <li key={`${effect.kind}-${String(index)}`}>
                    <EffectLine effect={effect} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <p className="font-semibold">Isto não pode ser desfeito.</p>

        {error !== null ? (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-900">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          {/* O foco inicial fica em Cancelar: Enter sem querer não apaga. */}
          <Button variant="outline" autoFocus disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="destructive" disabled={busy || impact === null || loadError !== null} onClick={() => void confirm()}>
            {busy ? 'Excluindo…' : 'Excluir'}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
