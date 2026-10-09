'use client';

import { useEffect, useState } from 'react';
import { Check, Pencil, Tags, Trash2 } from 'lucide-react';
import { competenceLong } from '@/components/cashflow/labels';
import { cn } from '@/lib/utils';
import { cents, formatBRL, parseBRL } from '@/lib/money';
import {
  Button,
  Canhoto,
  Checkbox,
  DateField,
  DateText,
  dataTalao,
  Input,
  Money,
  Parcela,
  Select,
} from '@/components/ui-kit';
import type { Transaction, TransactionOptions } from './schemas';
import { amountForInput, signedAmountCents } from './manual-sign';
import { groupByCompetence, installmentLabel, stripInstallmentSuffix } from './list-presentation';

const kindLabel: Record<Transaction['kind'], string> = {
  expense: 'Despesa',
  income: 'Receita',
  transfer: 'Transferência',
  credit_card_payment: 'Pagamento de fatura',
  investment_contribution: 'Aporte',
};

type TransactionListProps = {
  rows: Transaction[];
  options: TransactionOptions;
  selectedIds: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onEdit: (id: string) => void;
  onRule: (id: string) => void;
  onDelete: (id: string) => void;
  editingId: string | null;
  onSaveEdit: (id: string, input: TransactionEditValues) => Promise<void>;
  onCancelEdit: () => void;
};

export type TransactionEditValues = {
  occurredOn: string;
  description: string;
  amountCents: number;
  categoryId: string | null;
  memberId: string | null;
};

/**
 * Talão do canhoto: a parcela (03/10) quando a linha é parcelada com total conhecido, senão a data
 * sem barra (04 out). Parcela sem total cai para "parcela 03" em texto simples.
 */
function RowStub({ row }: { row: Transaction }) {
  if (row.installmentNumber !== null) {
    const label = installmentLabel(row.installmentNumber, row.installmentsCount);
    return label.total === null ? (
      <span className="text-center text-xs">{label.text}</span>
    ) : (
      <Parcela atual={row.installmentNumber} total={label.total} />
    );
  }
  return <span>{dataTalao(row.occurredOn)}</span>;
}

/** Descrição sem o "(03/10)" que o talão já mostra. */
function rowTitle(row: Transaction): string {
  if (row.installmentNumber === null) return row.description;
  const label = installmentLabel(row.installmentNumber, row.installmentsCount);
  return stripInstallmentSuffix(row.description, row.installmentNumber, label.total);
}

function sourceLabel(row: Transaction): string {
  if (row.accountName) return `Conta · ${row.accountName}`;
  if (row.creditCardName) return `Cartão · ${row.creditCardName}`;
  return 'Sem origem';
}

type EditorProps = {
  row: Transaction;
  options: TransactionOptions;
  onSave: (input: TransactionEditValues) => Promise<void>;
  onCancel: () => void;
};

function TransactionEditor({ row, options, onSave, onCancel }: EditorProps) {
  const [occurredOn, setOccurredOn] = useState(row.occurredOn);
  const [description, setDescription] = useState(row.description);
  const [amount, setAmount] = useState(formatBRL(amountForInput(row.amountCents, row.kind)));
  const [categoryId, setCategoryId] = useState(row.categoryId ?? '');
  const [memberId, setMemberId] = useState(row.memberId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedAmount = parseBRL(amount);
    if (parsedAmount === null) {
      setError('Informe um valor válido.');
      return;
    }
    // Despesa e Receita: o campo mostra sem sinal e a gravacao reaplica o sinal
    // do tipo, para editar nao inverter a direcao. Os demais seguem literais.
    const amountCents = signedAmountCents(parsedAmount, row.kind);
    setBusy(true);
    setError(null);
    try {
      await onSave({
        occurredOn,
        description: description.trim(),
        amountCents,
        categoryId: categoryId || null,
        memberId: memberId || null,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3 bg-secondary/40 p-3" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Data</span>
          <DateField value={occurredOn} onChange={setOccurredOn} required />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="text-xs text-muted-foreground">Descrição</span>
          <Input value={description} onChange={(event) => setDescription(event.target.value)} required maxLength={240} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Valor</span>
          <Input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Categoria</span>
          <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">Não categorizado</option>
            {options.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Responsável</span>
          <Select value={memberId} onChange={(event) => setMemberId(event.target.value)}>
            <option value="">Sem responsável</option>
            {options.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </Select>
        </label>
      </div>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancelar</Button>
        <Button type="submit" size="sm" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</Button>
      </div>
    </form>
  );
}

/**
 * Ações que moram no editor aberto abaixo da linha: criar regra e excluir. Numa linha só (sem
 * empilhar), com texto, em alvo de 44px no celular.
 */
function RowActions({
  description,
  onRule,
  onDelete,
}: {
  description: string;
  onRule: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-nowrap items-center gap-1 whitespace-nowrap">
      <Button variant="ghost" size="sm" aria-label={`Criar regra para ${description}`} onClick={onRule}>
        <Tags className="h-4 w-4" aria-hidden="true" />
        Criar regra
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        aria-label={`Excluir ${description}`}
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        Excluir
      </Button>
    </div>
  );
}

export function TransactionList({
  rows,
  options,
  selectedIds,
  onToggle,
  onToggleAll,
  onEdit,
  onRule,
  onDelete,
  editingId,
  onSaveEdit,
  onCancelEdit,
}: TransactionListProps) {
  // J e K: próximo e anterior lançamento, fora de campo de texto e sem modificadores (mesmo gesto de Importar).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== 'j' && key !== 'k') return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
      ) {
        return;
      }
      const ids = rows.map((row) => `lanc-${row.id}-abrir`);
      const current = target instanceof HTMLElement ? ids.indexOf(target.id) : -1;
      const next = key === 'j' ? (current < 0 ? 0 : current + 1) : current < 0 ? ids.length - 1 : current - 1;
      const element = ids[next] === undefined ? null : document.getElementById(ids[next] as string);
      if (element === null) return;
      event.preventDefault();
      element.focus();
      element.scrollIntoView({ block: 'center' });
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [rows]);

  if (rows.length === 0) return null;
  const allSelected = rows.every((row) => selectedIds.includes(row.id));
  const groups = groupByCompetence(rows);

  return (
    <section aria-label="Lançamentos, do mês atual para os anteriores e depois os futuros" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 border border-border bg-card px-3 py-1">
        <Checkbox label="Selecionar todos" checked={allSelected} onChange={onToggleAll} />
        <p className="text-xs text-muted-foreground">
          <span className="[@media(pointer:coarse)]:hidden">Clique</span>
          <span className="hidden [@media(pointer:coarse)]:inline">Toque</span> no canhoto para selecionar.{' '}
          <span className="[@media(pointer:coarse)]:hidden">
            <kbd className="num border border-border bg-card px-1">J</kbd> /{' '}
            <kbd className="num border border-border bg-card px-1">K</kbd> pulam entre as linhas.
          </span>
        </p>
      </div>
      {groups.map((group) => (
        <div key={group.competence} className="flex flex-col gap-1.5">
          <h3 className="flex flex-col gap-0.5 border-b-2 border-foreground pb-1 text-sm font-semibold sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
            <span className="first-letter:uppercase">{competenceLong(group.competence)}</span>
            <span className="flex items-baseline gap-2 font-normal text-muted-foreground">
              {group.rows.length} {group.rows.length === 1 ? 'lançamento' : 'lançamentos'} · receitas − despesas{' '}
              <Money value={cents(group.totalCents)} className="font-semibold text-foreground" />
            </span>
          </h3>
          <ul className="flex flex-col gap-1.5">
            {group.rows.map((row) => {
              const title = rowTitle(row);
              const editing = editingId === row.id;
              const selected = selectedIds.includes(row.id);
              const marcas = [
                ...(row.status === 'planned' ? [{ label: 'Previsto', tone: 'neutral' as const }] : []),
                ...(row.categoryName === null ? [{ label: 'Não categorizado', tone: 'attention' as const }] : []),
              ];
              return (
                <li key={row.id}>
                  <Canhoto
                    as="article"
                    ariaLabel={`Lançamento: ${title}`}
                    selecionado={selected}
                    stub={
                      <button
                        type="button"
                        aria-pressed={selected}
                        aria-label={`Selecionar ${title}`}
                        onClick={() => onToggle(row.id)}
                        className={cn(
                          'flex h-full min-h-11 w-full cursor-pointer flex-col items-center justify-center gap-1 transition-colors hover:bg-primary/10 hover:ring-1 hover:ring-inset hover:ring-primary/40 active:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                          selected && 'font-semibold text-primary',
                        )}
                      >
                        {selected ? <Check className="h-4 w-4 text-primary" strokeWidth={3} aria-hidden="true" /> : null}
                        <RowStub row={row} />
                      </button>
                    }
                    marcas={marcas}
                    valor={<Money value={row.amountCents} />}
                    footer={
                      editing ? (
                        <div className="flex flex-col gap-2">
                          <TransactionEditor row={row} options={options} onSave={(input) => onSaveEdit(row.id, input)} onCancel={onCancelEdit} />
                          <div className="flex justify-start border-t border-border pt-2">
                            <RowActions description={title} onRule={() => onRule(row.id)} onDelete={() => onDelete(row.id)} />
                          </div>
                        </div>
                      ) : null
                    }
                  >
                    <button
                      id={`lanc-${row.id}-abrir`}
                      type="button"
                      aria-expanded={editing}
                      aria-label={`${editing ? 'Fechar' : 'Abrir'} ${title}`}
                      onClick={() => (editing ? onCancelEdit() : onEdit(row.id))}
                      className="flex min-h-11 min-w-0 items-center gap-2 text-left text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8"
                    >
                      <span className="truncate" title={title}>{title}</span>
                      <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                    <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span><DateText value={row.occurredOn} /> · {kindLabel[row.kind]}</span>
                      <span className="truncate" title={sourceLabel(row)}>{sourceLabel(row)}</span>
                      {row.categoryName ? <span className="truncate text-foreground" title={row.categoryName}>{row.categoryName}</span> : null}
                      {row.memberName ? <span className="truncate">{row.memberName}</span> : null}
                    </p>
                  </Canhoto>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
