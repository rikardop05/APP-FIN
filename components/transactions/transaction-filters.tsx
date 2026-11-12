'use client';

import { useId } from 'react';

import { Button, Checkbox, DateField, Input, Select } from '@/components/ui-kit';
import { cn } from '@/lib/utils';

import {
  activeFilterCount,
  filterToggleLabel,
  panelFilterCount,
  panelFilterLabels,
  quickToggles,
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
  /**
   * Alternância "Todos os meses" para o celular: lá ela entra na fila dos filtros rápidos, porque na
   * linha da navegação de mês não cabe. A partir de `sm` quem a mostra é a própria navegação.
   */
  allMonths: { pressed: boolean; onToggle: () => void };
};

/**
 * Filtros da lista. Sempre à vista (Lote 2, item 5): os botões de alternância (Receitas, Despesas,
 * Cartão, Conta e um por responsável) e a busca por texto. Atrás do botão "Filtros", que diz quantos
 * dos seus estão ativos, fica o resto: período, categoria, conta e cartão específicos, situação e "só
 * não categorizados".
 *
 * Tudo APLICA SOZINHO (a tela decide quando consultar; não há botão de enviar). Com o painel fechado, o
 * resumo em texto diz quais filtros dele valem. Teclado: Tab vai do botão aos campos, e Esc fecha o
 * painel e devolve o foco ao botão. No celular os botões de alternância ficam numa fila só, que rola
 * para o lado, para não empurrar a lista para baixo.
 */
export function TransactionFilters({ value, options, open, onOpenChange, onChange, onClear, allMonths }: TransactionFiltersProps) {
  const panelId = useId();
  const toggleId = useId();
  const searchId = useId();
  const panelCount = panelFilterCount(value);
  const labels = panelFilterLabels(value, options);
  const toggles = quickToggles(value, options.members);

  return (
    <section
      aria-label="Filtros dos lançamentos"
      className="flex flex-col gap-2"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          onOpenChange(false);
          document.getElementById(toggleId)?.focus();
        }
      }}
    >
      {/* Botões de alternância: quadrados, com `aria-pressed` (o estado não é só cor: o ligado inverte o fundo). */}
      <div
        role="group"
        aria-label="Filtros rápidos"
        className="-mx-1 flex flex-nowrap items-center gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible sm:pb-0"
      >
        <QuickButton label="Todos os meses" pressed={allMonths.pressed} onClick={allMonths.onToggle} className="sm:hidden" />
        {toggles.map((toggle) => (
          <QuickButton key={toggle.key} label={toggle.label} pressed={toggle.pressed} onClick={() => onChange(toggle.next)} />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor={searchId} className="sr-only">
          Buscar por texto
        </label>
        <Input
          id={searchId}
          type="search"
          value={value.search}
          placeholder="Buscar na descrição"
          className="min-w-0 flex-1"
          onChange={(event) => onChange({ search: event.target.value })}
        />
        <Button
          id={toggleId}
          variant="outline"
          className="shrink-0"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onOpenChange(!open)}
        >
          {filterToggleLabel(panelCount)}
        </Button>
      </div>

      {activeFilterCount(value) > 0 || (!open && labels.length > 0) ? (
        <div className="flex flex-wrap items-center gap-x-2">
          {activeFilterCount(value) > 0 ? (
            <Button variant="ghost" size="sm" onClick={onClear}>
              Limpar filtros
            </Button>
          ) : null}
          {!open && labels.length > 0 ? <p className="text-sm text-muted-foreground">{labels.join(' · ')}</p> : null}
        </div>
      ) : null}

      {open ? (
        <div id={panelId} className="flex flex-col gap-4 border border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Data inicial</span>
              <DateField value={value.from} onChange={(iso) => onChange({ from: iso })} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Data final</span>
              <DateField value={value.to} onChange={(iso) => onChange({ to: iso })} />
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
              <span className="text-xs text-muted-foreground">Situação</span>
              <Select value={value.settlement} onChange={(event) => onChange({ settlement: event.target.value === 'paid' ? 'paid' : event.target.value === 'pending' ? 'pending' : '' })}>
                <option value="">Todos</option>
                <option value="paid">Pagos</option>
                <option value="pending">Pendentes</option>
              </Select>
            </label>
            {/* Uma conta ou um cartão ESPECÍFICO: o botão rápido vale para qualquer um; escolher aqui desliga o rápido oposto. */}
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Uma conta</span>
              <Select
                value={value.accountId}
                onChange={(event) =>
                  onChange({ accountId: event.target.value, ...(event.target.value !== '' && value.origin === 'card' ? { origin: '' } : {}) })
                }
              >
                <option value="">Todas as contas</option>
                {options.accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Um cartão</span>
              <Select
                value={value.creditCardId}
                onChange={(event) =>
                  onChange({ creditCardId: event.target.value, ...(event.target.value !== '' && value.origin === 'account' ? { origin: '' } : {}) })
                }
              >
                <option value="">Todos os cartões</option>
                {options.cards.map((card) => (
                  <option key={card.id} value={card.id}>{card.name}</option>
                ))}
              </Select>
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

/** Botão de alternância: canto reto (o mundo do carnê não tem pílula), 44px de toque no celular. */
function QuickButton({
  label,
  pressed,
  onClick,
  className,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex h-11 shrink-0 items-center justify-center whitespace-nowrap border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:text-xs',
        pressed
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input bg-card text-foreground hover:bg-secondary/60',
        className,
      )}
    >
      {label}
    </button>
  );
}
