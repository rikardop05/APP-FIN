'use client';

import { useState } from 'react';
import { Pencil, Tags, Trash2 } from 'lucide-react';
import { competenceShort } from '@/components/cashflow/labels';
import { formatBRL, parseBRL } from '@/lib/money';
import {
  Parcela,
  Selo,
  Button,
  Checkbox,
  DateText,
  Input,
  Money,
  Select,
} from '@/components/ui-kit';
import type { Transaction, TransactionOptions } from './schemas';
import { amountForInput, signedAmountCents } from './manual-sign';
import { installmentLabel } from './list-presentation';

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

/** Parcela 03/10 (canhoto); sem o total do plano, cai para "parcela 03". */
function InstallmentMark({ row }: { row: Transaction }) {
  if (row.installmentNumber === null) return null;
  const label = installmentLabel(row.installmentNumber, row.installmentsCount);
  return label.total === null ? (
    <span className="text-xs text-muted-foreground">{label.text}</span>
  ) : (
    <Parcela atual={row.installmentNumber} total={label.total} className="text-xs text-muted-foreground" />
  );
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
 * Ações da linha numa linha só (sem empilhar). Na tabela viram botões de ícone com nome acessível e
 * dica, para o "Excluir" nunca cortar em 1440px; no cartão do celular mostram o texto.
 */
function RowActions({
  description,
  compact,
  onEdit,
  onRule,
  onDelete,
}: {
  description: string;
  compact: boolean;
  onEdit: () => void;
  onRule: () => void;
  onDelete: () => void;
}) {
  const labelClass = compact ? 'sr-only' : 'ml-1';
  const iconClass = 'h-4 w-4';
  return (
    <div className="flex flex-nowrap items-center gap-1 whitespace-nowrap">
      <Button variant="ghost" size="sm" title="Editar" aria-label={`Editar ${description}`} onClick={onEdit}>
        <Pencil className={iconClass} aria-hidden="true" /><span className={labelClass}>Editar</span>
      </Button>
      <Button variant="ghost" size="sm" title="Criar regra" aria-label={`Criar regra para ${description}`} onClick={onRule}>
        <Tags className={iconClass} aria-hidden="true" /><span className={labelClass}>Criar regra</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        title="Excluir"
        aria-label={`Excluir ${description}`}
        onClick={onDelete}
      >
        <Trash2 className={iconClass} aria-hidden="true" /><span className={labelClass}>Excluir</span>
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
    <div className="flex flex-col gap-3">
      <div className="hidden overflow-hidden border border-border md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Lançamentos, do mês atual para os anteriores e depois os futuros</caption>
          <thead>
            <tr className="border-b border-border bg-secondary/40 text-left text-xs text-muted-foreground">
              <th className="w-12 px-3 py-3"><Checkbox aria-label="Selecionar todos os lançamentos" checked={allSelected} onChange={onToggleAll} /></th>
              <th className="px-3 py-3 font-medium">Data</th>
              <th className="px-3 py-3 font-medium">Descrição</th>
              <th className="px-3 py-3 text-right font-medium">Valor</th>
              <th className="px-3 py-3 font-medium">Origem</th>
              <th className="px-3 py-3 font-medium">Categoria</th>
              <th className="px-3 py-3 font-medium">Responsável</th>
              <th scope="col" className="px-3 py-3 font-medium">Ações</th>
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
                    <td className="max-w-[18rem] px-3 py-3 align-top"><div className="truncate font-medium" title={row.description}>{row.description}</div><span className="text-xs text-muted-foreground">{kindLabel[row.kind]}</span><InstallmentMark row={row} />{row.status === 'planned' ? <Selo tone="neutral" label="Previsto" className="ml-2" /> : null}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right align-top"><Money value={row.amountCents} /></td>
                    <td className="max-w-[10rem] truncate px-3 py-3 align-top text-muted-foreground" title={sourceLabel(row)}>{sourceLabel(row)}</td>
                    <td className="px-3 py-3 align-top">{row.categoryName ? row.categoryName : <Selo tone="attention" label="Não categorizado" />}</td>
                    <td className="px-3 py-3 align-top text-muted-foreground">{row.memberName ?? '—'}</td>
                    <td className="px-3 py-3 align-top"><RowActions compact description={row.description} onEdit={() => onEdit(row.id)} onRule={() => onRule(row.id)} onDelete={() => onDelete(row.id)} /></td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 md:hidden">
        <div className="flex items-center justify-between border border-border bg-card px-3 py-1">
          <Checkbox label="Selecionar todos" checked={allSelected} onChange={onToggleAll} />
        </div>
        {rows.map((row) => (
          <article key={row.id} className="border border-border bg-card px-3 py-2">
            {editingId === row.id ? (
              <TransactionEditor row={row} options={options} onSave={(input) => onSaveEdit(row.id, input)} onCancel={onCancelEdit} />
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <Checkbox aria-label={`Selecionar ${row.description}`} checked={selectedIds.includes(row.id)} onChange={() => onToggle(row.id)} />
                    <div className="min-w-0">
                      <p className="truncate font-medium" title={row.description}>{row.description}</p>
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                        <span><DateText value={row.occurredOn} /> · {kindLabel[row.kind]} · {competenceShort(row.competence)}</span>
                        <InstallmentMark row={row} />
                        {row.status === 'planned' ? <Selo tone="neutral" label="Previsto" /> : null}
                      </p>
                    </div>
                  </div>
                  <Money value={row.amountCents} className="shrink-0" />
                </div>
                <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 pl-11 text-sm">
                  <div className="min-w-0 text-muted-foreground"><dt className="sr-only">Origem</dt><dd className="truncate" title={sourceLabel(row)}>{sourceLabel(row)}</dd></div>
                  <div className="min-w-0"><dt className="sr-only">Categoria</dt><dd className="truncate" title={row.categoryName ?? undefined}>{row.categoryName ?? <Selo tone="attention" label="Não categorizado" />}</dd></div>
                  {row.memberName ? <div className="min-w-0"><dt className="sr-only">Responsável</dt><dd className="truncate text-muted-foreground">{row.memberName}</dd></div> : null}
                </dl>
                <div className="mt-1 border-t border-border pt-1"><RowActions compact={false} description={row.description} onEdit={() => onEdit(row.id)} onRule={() => onRule(row.id)} onDelete={() => onDelete(row.id)} /></div>
              </>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
