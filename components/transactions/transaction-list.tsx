'use client';

import { useState } from 'react';
import { Pencil, Tags } from 'lucide-react';
import { formatBRL, parseBRL } from '@/lib/money';
import {
  Badge,
  Button,
  Checkbox,
  DateText,
  Input,
  Money,
  Select,
} from '@/components/ui-kit';
import type { Transaction, TransactionOptions } from './schemas';

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
  const [amount, setAmount] = useState(formatBRL(row.amountCents));
  const [categoryId, setCategoryId] = useState(row.categoryId ?? '');
  const [memberId, setMemberId] = useState(row.memberId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCents = parseBRL(amount);
    if (amountCents === null) {
      setError('Informe um valor válido.');
      return;
    }
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
    <form className="flex flex-col gap-3 rounded-md bg-secondary/40 p-3" onSubmit={submit}>
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

function RowActions({ onEdit, onRule }: { onEdit: () => void; onRule: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="ghost" size="sm" onClick={onEdit}>
        <Pencil className="mr-1 h-4 w-4" aria-hidden="true" /> Editar
      </Button>
      <Button variant="ghost" size="sm" onClick={onRule}>
        <Tags className="mr-1 h-4 w-4" aria-hidden="true" /> Criar regra
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
  editingId,
  onSaveEdit,
  onCancelEdit,
}: TransactionListProps) {
  if (rows.length === 0) return null;
  const allSelected = rows.every((row) => selectedIds.includes(row.id));

  return (
    <div className="flex flex-col gap-3">
      <div className="hidden overflow-hidden rounded-lg border border-border md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-12 px-3 py-3"><Checkbox aria-label="Selecionar todos os lançamentos" checked={allSelected} onChange={onToggleAll} /></th>
              <th className="px-3 py-3 font-medium">Data</th>
              <th className="px-3 py-3 font-medium">Descrição</th>
              <th className="px-3 py-3 text-right font-medium">Valor</th>
              <th className="px-3 py-3 font-medium">Origem</th>
              <th className="px-3 py-3 font-medium">Categoria</th>
              <th className="px-3 py-3 font-medium">Responsável</th>
              <th className="px-3 py-3 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                {editingId === row.id ? (
                  <td colSpan={8} className="p-3">
                    <TransactionEditor row={row} options={options} onSave={(input) => onSaveEdit(row.id, input)} onCancel={onCancelEdit} />
                  </td>
                ) : (
                  <>
                    <td className="px-3 py-3 align-top"><Checkbox aria-label={`Selecionar ${row.description}`} checked={selectedIds.includes(row.id)} onChange={() => onToggle(row.id)} /></td>
                    <td className="whitespace-nowrap px-3 py-3 align-top"><DateText value={row.occurredOn} /></td>
                    <td className="max-w-[18rem] px-3 py-3 align-top"><div className="truncate font-medium" title={row.description}>{row.description}</div><span className="text-xs text-muted-foreground">{kindLabel[row.kind]}</span></td>
                    <td className="whitespace-nowrap px-3 py-3 text-right align-top"><Money value={row.amountCents} /></td>
                    <td className="max-w-[10rem] truncate px-3 py-3 align-top text-muted-foreground" title={sourceLabel(row)}>{sourceLabel(row)}</td>
                    <td className="px-3 py-3 align-top">{row.categoryName ? row.categoryName : <Badge variant="warning">Não categorizado</Badge>}</td>
                    <td className="px-3 py-3 align-top text-muted-foreground">{row.memberName ?? '—'}</td>
                    <td className="px-3 py-3 align-top"><RowActions onEdit={() => onEdit(row.id)} onRule={() => onRule(row.id)} /></td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 md:hidden">
        <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
          <Checkbox label="Selecionar todos" checked={allSelected} onChange={onToggleAll} />
          <span className="text-xs text-muted-foreground">{rows.length} lançamentos</span>
        </div>
        {rows.map((row) => (
          <article key={row.id} className="rounded-lg border border-border bg-card p-4">
            {editingId === row.id ? (
              <TransactionEditor row={row} options={options} onSave={(input) => onSaveEdit(row.id, input)} onCancel={onCancelEdit} />
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <Checkbox aria-label={`Selecionar ${row.description}`} checked={selectedIds.includes(row.id)} onChange={() => onToggle(row.id)} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{row.description}</p>
                      <p className="text-sm text-muted-foreground"><DateText value={row.occurredOn} /> · {kindLabel[row.kind]}</p>
                    </div>
                  </div>
                  <Money value={row.amountCents} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
                  <div><dt className="text-xs text-muted-foreground">Origem</dt><dd className="truncate">{sourceLabel(row)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Categoria</dt><dd>{row.categoryName ?? <Badge variant="warning">Não categorizado</Badge>}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Responsável</dt><dd>{row.memberName ?? '—'}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Competência</dt><dd>{row.competence}</dd></div>
                </dl>
                <div className="mt-3 border-t border-border pt-3"><RowActions onEdit={() => onEdit(row.id)} onRule={() => onRule(row.id)} /></div>
              </>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
