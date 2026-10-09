'use client';

import { useState } from 'react';
import { Pencil, Tags, Trash2 } from 'lucide-react';
import { competenceShort } from '@/components/cashflow/labels';
import { formatBRL, parseBRL } from '@/lib/money';
import { formatDateBR } from '@/lib/date';
import {
  Button,
  Canhoto,
  Checkbox,
  DateText,
  Input,
  Money,
  Parcela,
  Select,
} from '@/components/ui-kit';
import type { Transaction, TransactionOptions } from './schemas';
import { amountForInput, signedAmountCents } from './manual-sign';
import { installmentLabel, stripInstallmentSuffix } from './list-presentation';

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
 * (dd/mm). Parcela sem total cai para "parcela 03" em texto simples.
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
  return <span>{formatDateBR(row.occurredOn).slice(0, 5)}</span>;
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
          <Input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} required />
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
  if (rows.length === 0) return null;
  const allSelected = rows.every((row) => selectedIds.includes(row.id));

  return (
    <section aria-label="Lançamentos, do mês atual para os anteriores e depois os futuros" className="flex flex-col gap-2">
      <div className="flex items-center justify-between border border-border bg-card px-3 py-1">
        <Checkbox label="Selecionar todos" checked={allSelected} onChange={onToggleAll} />
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const title = rowTitle(row);
          const editing = editingId === row.id;
          const marcas = [
            ...(row.status === 'planned' ? [{ label: 'Previsto', tone: 'neutral' as const }] : []),
            ...(row.categoryName === null ? [{ label: 'Não categorizado', tone: 'attention' as const }] : []),
          ];
          return (
            <li key={row.id}>
              <Canhoto
                as="article"
                ariaLabel={`Lançamento: ${title}`}
                stub={<RowStub row={row} />}
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
                <div className="flex min-w-0 items-center gap-1">
                  <Checkbox aria-label={`Selecionar ${title}`} checked={selectedIds.includes(row.id)} onChange={() => onToggle(row.id)} />
                  <button
                    type="button"
                    aria-expanded={editing}
                    aria-label={`${editing ? 'Fechar' : 'Abrir'} ${title}`}
                    onClick={() => (editing ? onCancelEdit() : onEdit(row.id))}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8"
                  >
                    <span className="truncate" title={title}>{title}</span>
                    <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                </div>
                <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span><DateText value={row.occurredOn} /> · {kindLabel[row.kind]} · {competenceShort(row.competence)}</span>
                  <span className="truncate" title={sourceLabel(row)}>{sourceLabel(row)}</span>
                  {row.categoryName ? <span className="truncate text-foreground" title={row.categoryName}>{row.categoryName}</span> : null}
                  {row.memberName ? <span className="truncate">{row.memberName}</span> : null}
                </p>
              </Canhoto>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
