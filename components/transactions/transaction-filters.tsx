'use client';

import { useId } from 'react';

import { Button, Checkbox, Input, Select } from '@/components/ui-kit';

import {
  activeFilterCount,
  activeFilterLabels,
  filterToggleLabel,
  type TransactionFilterValues,
} from './filter-presentation';
import type { TransactionOptions } from './schemas';

export type { TransactionFilterValues } from './filter-presentation';

type TransactionFiltersProps = {
  value: TransactionFilterValues;
  options: TransactionOptions;
  /** Painel aberto? O estado mora na tela, que o recolhe sozinha ao limpar. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: Partial<TransactionFilterValues>) => void;
  onClear: () => void;
};

/**
 * Filtros da lista (impeccable distill): recolhidos atrás de UM botão que diz quantos estão ativos, e
 * APLICAM SOZINHOS (a tela decide quando consultar; não há botão "Filtrar"). Com o painel fechado, o
 * resumo em texto diz quais filtros valem. Teclado: Tab vai do botão aos campos, e Esc fecha o painel
 * e devolve o foco ao botão.
 */
export function TransactionFilters({ value, options, open, onOpenChange, onChange, onClear }: TransactionFiltersProps) {
  const panelId = useId();
  const toggleId = useId();
  const count = activeFilterCount(value);
  const labels = activeFilterLabels(value, options);

  return (
    <section
      aria-label="Filtros dos lançamentos"
      className="flex flex-col gap-3"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          onOpenChange(false);
          document.getElementById(toggleId)?.focus();
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          id={toggleId}
          variant="outline"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onOpenChange(!open)}
        >
          {filterToggleLabel(count)}
        </Button>
        {count > 0 ? (
          <Button variant="ghost" onClick={onClear}>
            Limpar filtros
          </Button>
        ) : null}
        {!open && labels.length > 0 ? (
          <p className="text-sm text-muted-foreground">{labels.join(' · ')}</p>
        ) : null}
      </div>

      {open ? (
        <div id={panelId} className="flex flex-col gap-4 border border-border bg-card p-4">
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
          <Checkbox
            label="Somente não categorizados"
            checked={value.uncategorized}
            onChange={(event) => onChange({ uncategorized: event.target.checked, categoryId: event.target.checked ? '' : value.categoryId })}
          />
        </div>
      ) : null}
    </section>
  );
}
