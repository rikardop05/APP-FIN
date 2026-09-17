'use client';

import { Button, Checkbox, Input, Select } from '@/components/ui-kit';
import type { TransactionOptions } from './schemas';

export type TransactionFilterValues = {
  from: string;
  to: string;
  categoryId: string;
  accountId: string;
  creditCardId: string;
  memberId: string;
  search: string;
  uncategorized: boolean;
};

type TransactionFiltersProps = {
  value: TransactionFilterValues;
  options: TransactionOptions;
  busy: boolean;
  onChange: (value: Partial<TransactionFilterValues>) => void;
  onSubmit: () => void;
  onClear: () => void;
};

export function TransactionFilters({
  value,
  options,
  busy,
  onChange,
  onSubmit,
  onClear,
}: TransactionFiltersProps) {
  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">Filtrar lançamentos</h2>
        <p className="text-sm text-muted-foreground">
          Encontre uma compra, receita ou transferência sem sair da tela.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Data inicial</span>
          <Input type="date" value={value.from} onChange={(event) => onChange({ from: event.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Data final</span>
          <Input type="date" value={value.to} onChange={(event) => onChange({ to: event.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Categoria</span>
          <Select value={value.categoryId} onChange={(event) => onChange({ categoryId: event.target.value, uncategorized: false })}>
            <option value="">Todas as categorias</option>
            {options.categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Conta</span>
          <Select value={value.accountId} onChange={(event) => onChange({ accountId: event.target.value })}>
            <option value="">Todas as contas</option>
            {options.accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Cartão</span>
          <Select value={value.creditCardId} onChange={(event) => onChange({ creditCardId: event.target.value })}>
            <option value="">Todos os cartões</option>
            {options.cards.map((card) => (
              <option key={card.id} value={card.id}>{card.name}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Responsável</span>
          <Select value={value.memberId} onChange={(event) => onChange({ memberId: event.target.value })}>
            <option value="">Todos os responsáveis</option>
            {options.members.map((member) => (
              <option key={member.id} value={member.id}>{member.name}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="text-xs text-muted-foreground">Texto</span>
          <Input
            type="search"
            value={value.search}
            placeholder="Descrição do lançamento"
            onChange={(event) => onChange({ search: event.target.value })}
          />
        </label>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Checkbox
          label="Somente não categorizados"
          checked={value.uncategorized}
          onChange={(event) => onChange({ uncategorized: event.target.checked, categoryId: event.target.checked ? '' : value.categoryId })}
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="ghost" onClick={onClear} disabled={busy}>Limpar</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Filtrando…' : 'Filtrar'}</Button>
        </div>
      </div>
    </form>
  );
}
