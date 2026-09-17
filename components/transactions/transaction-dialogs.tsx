'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { parseBRL } from '@/lib/money';
import { Button, Input, Select } from '@/components/ui-kit';
import type { RuleSuggestion, TransactionOptions } from './schemas';

function DialogShell({
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

export function ManualTransactionDialog({
  today,
  options,
  busy,
  onClose,
  onSubmit,
}: {
  today: string;
  options: TransactionOptions;
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: ManualValues) => Promise<void>;
}) {
  const [occurredOn, setOccurredOn] = useState(today);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<ManualValues['kind']>('expense');
  const [categoryId, setCategoryId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [accountId, setAccountId] = useState(options.accounts[0]?.id ?? '');
  const [creditCardId, setCreditCardId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCents = parseBRL(amount);
    if (amountCents === null) {
      setError('Informe um valor válido. Saídas devem ser negativas.');
      return;
    }
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
          <label className="flex flex-col gap-1 text-sm"><span className="text-xs text-muted-foreground">Valor</span><Input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="-R$ 0,00" inputMode="decimal" required /><span className="text-xs text-muted-foreground">Use valor negativo para saída.</span></label>
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
