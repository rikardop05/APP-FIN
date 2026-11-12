'use client';

import { useEffect, useState } from 'react';
import { Check, Pencil, Tags, Trash2 } from 'lucide-react';
import { competenceLong, competenceShort } from '@/components/cashflow/labels';
import { cn } from '@/lib/utils';
import { cents, formatBRL, parseBRL } from '@/lib/money';
import { countLabel } from './month-view';
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
  Selo,
} from '@/components/ui-kit';
import type { SeloTone } from '@/components/ui-kit';
import type { Transaction, TransactionOptions } from './schemas';
import { amountForInput, amountOnKindChange, signedAmountCents } from './manual-sign';
import {
  buildEditValues,
  categoryAfterKindChange,
  directionChange,
  editableKindLabel,
  readEditableKind,
  showsKindField,
  type TransactionEditValues,
} from './edit-values';
import { EDITABLE_TRANSACTION_KINDS } from '@/lib/db/queries/transactions-editable-kinds';
import { paymentSituation } from './payment-situation';
import { commonMarks, groupByCompetence, installmentLabel, isBankText, isIncompleteDescription, rowMarkLabels, rowMarkTone, rowMetaParts, stripInstallmentSuffix } from './list-presentation';

const kindLabel: Record<Transaction['kind'], string> = {
  expense: 'Despesa',
  income: 'Receita',
  transfer: 'Transferência',
  credit_card_payment: 'Pagamento de fatura',
  investment_contribution: 'Aporte',
};

type TransactionListProps = {
  rows: Transaction[];
  /** Hoje (YYYY-MM-DD): decide "vencida" e "a vencer" no selo da fatura. */
  today: string;
  /** Pago e pendente das faturas de cartão por competência, já calculados pela query. */
  settlement: { competence: string; paidCents: number; pendingCents: number }[];
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

export type { TransactionEditValues };

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

/** Descrição do canhoto: humanizada quando a linha é incompleta ("NULL" do banco não repete). */
function rowTitle(row: Transaction): string {
  if (isIncompleteDescription(row.description)) return 'Sem descrição — toque para editar';
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
  // Descrição incompleta ("NULL" do banco): o campo abre VAZIO, para a pessoa digitar a de verdade.
  const [description, setDescription] = useState(isIncompleteDescription(row.description) ? '' : row.description);
  const [amount, setAmount] = useState(formatBRL(amountForInput(row.amountCents, row.kind)));
  // Tipo: editável só em lançamento de conta já lançado (a regra é a do servidor).
  const [kind, setKind] = useState(row.kind);
  const kindEditable = showsKindField(row);
  // Despesa e Receita: valor sem sinal (o tipo define a direção). Os demais levam o sinal digitado.
  const signedInput = kind !== 'expense' && kind !== 'income';
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
    setBusy(true);
    setError(null);
    try {
      // Despesa e Receita: o campo mostra sem sinal e a gravacao reaplica o sinal
      // do tipo, para editar nao inverter a direcao. Os demais seguem literais.
      await onSave(buildEditValues(row, { occurredOn, description, typedAmountCents: parsedAmount, kind, categoryId, memberId }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  // Trocar para Receita ou Despesa pode inverter a direção (o sinal vem do tipo): avisa antes de salvar.
  const typedNow = parseBRL(amount);
  const flipped =
    kind === row.kind || typedNow === null ? null : directionChange(row.amountCents, signedAmountCents(typedNow, kind));

  /**
   * Troca de tipo: o valor do campo é reexibido no tipo novo SEM mudar a direção do dinheiro (uma
   * Despesa de 100 vira Transferência de -100), e a categoria que não cabe mais é limpa.
   */
  function changeKind(value: string) {
    const next = readEditableKind(value);
    if (next === null || next === kind) return;
    const typed = parseBRL(amount);
    if (typed !== null) setAmount(formatBRL(amountOnKindChange(typed, kind, next)));
    setCategoryId(categoryAfterKindChange(categoryId, next, options.categories));
    setKind(next);
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
          {kindEditable && signedInput ? <span className="text-xs text-muted-foreground">Use valor negativo para saída.</span> : null}
        </label>
        {kindEditable ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Tipo</span>
            <Select value={kind} onChange={(event) => changeKind(event.target.value)}>
              {EDITABLE_TRANSACTION_KINDS.map((option) => <option key={option} value={option}>{editableKindLabel[option]}</option>)}
            </Select>
            {kind === 'transfer' && row.kind !== 'transfer' ? (
              <span className="text-xs text-muted-foreground">Transferência não entra em receita nem em despesa: sai da sobra do mês.</span>
            ) : null}
          </label>
        ) : null}
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
      {flipped !== null ? (
        <p className="border border-border bg-card px-3 py-2 text-sm text-foreground" role="status">
          <strong className="font-semibold">Atenção: a direção do dinheiro muda.</strong>{' '}
          {flipped === 'to-inflow'
            ? 'Este lançamento era uma saída e vai ser gravado como entrada.'
            : 'Este lançamento era uma entrada e vai ser gravado como saída.'}{' '}
          O saldo da conta muda junto. Se não é isso, escolha outro tipo.
        </p>
      ) : null}
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
  today,
  settlement,
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
      {groups.map((group) => {
        const shared = commonMarks(group.rows);
        return (
        <div key={group.competence} className="flex flex-col gap-1.5">
          {/* h2 = só o MÊS (impeccable clarify): nome acessível curto, sem selos dentro do heading. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b-2 border-foreground pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold first-letter:uppercase">{competenceLong(group.competence)}</h2>
              {shared.map(({ label, count }) => (
                <span key={label} className="inline-flex items-center gap-1">
                  <Selo tone={rowMarkTone(label)} label={label} />
                  <span className="text-xs font-normal text-muted-foreground">{count} de {group.rows.length}</span>
                </span>
              ))}
            </div>
            {/* Só a contagem: Receitas, Despesas e Sobra do mês ficam no resumo do topo, vindos do motor. */}
            <span className="text-xs font-normal text-muted-foreground">{countLabel(group.rows.length)}</span>
          </div>
          {(() => {
            const faturas = settlement.find((item) => item.competence === group.competence);
            if (faturas === undefined || faturas.paidCents === 0 && faturas.pendingCents === 0) return null;
            return (
              <p className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
                <span>Todas as faturas de {competenceShort(group.competence)}:</span>
                <span>Pago <Money value={cents(faturas.paidCents)} sign="never" className="font-semibold text-foreground" /></span>
                <span aria-hidden="true">·</span>
                <span>Pendente <Money value={cents(faturas.pendingCents)} sign="never" className="font-semibold text-foreground" /></span>
              </p>
            );
          })()}
          <ul className="flex flex-col gap-1.5">
            {group.rows.map((row) => {
              const title = rowTitle(row);
              const editing = editingId === row.id;
              const selected = selectedIds.includes(row.id);
              // Selo na linha só quando ela difere do grupo (o que é comum a todas sobe para o cabeçalho do mês).
              const marcas: { label: string; tone: SeloTone; letter?: string }[] = rowMarkLabels(row)
                .filter((label) => !shared.some((item) => item.label === label))
                .map((label) => ({ label, tone: rowMarkTone(label) }));
              // Situação da fatura do lançamento de cartão: texto + letra do selo (nunca só cor).
              const pagamento = paymentSituation(row, today);
              if (pagamento !== null) marcas.push({ label: pagamento.label, tone: pagamento.tone, letter: pagamento.letter });
              const meta = rowMetaParts({
                kindLabel: kindLabel[row.kind],
                sourceLabel: sourceLabel(row),
                categoryName: row.categoryName,
                memberName: row.memberName,
              });
              const bankText = isBankText(row);
              return (
                <li key={row.id}>
                  <Canhoto
                    as="article"
                    ariaLabel={`Lançamento: ${title}`}
                    selecionado={selected}
                    // Linha incompleta leva a régua de carimbo (o selo Incompleta diz o porquê).
                    destaque={marcas.some((marca) => marca.label === 'Incompleta') ? 'danger' : undefined}
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
                    // No celular o valor mora na MESMA linha da descrição (dentro do corpo, abaixo); a coluna
                    // de valor do canhoto só aparece a partir de `sm`.
                    valor={<Money value={row.amountCents} className="hidden sm:inline" />}
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
                    {/*
                      Linha compacta (Lote 2, item 6): descrição e valor na mesma linha, apoio numa linha só.
                      O botão da descrição estica a área de clique sobre o corpo inteiro (`after:inset-0`), então
                      o alvo de toque é o corpo (44px ou mais) sem a descrição precisar de 44px só para ela.
                    */}
                    <div className="relative flex min-h-11 min-w-0 flex-col justify-center gap-0.5 sm:min-h-0 sm:gap-0">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <button
                          id={`lanc-${row.id}-abrir`}
                          type="button"
                          aria-expanded={editing}
                          aria-label={`${editing ? 'Fechar' : 'Abrir'} ${title}`}
                          onClick={() => (editing ? onCancelEdit() : onEdit(row.id))}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-foreground after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="truncate" title={title}>{title}</span>
                          <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        </button>
                        <Money value={row.amountCents} className="shrink-0 text-base sm:hidden" />
                      </div>
                      <p className="flex min-w-0 items-baseline gap-x-1.5 text-xs text-muted-foreground">
                        {/* No celular o talão já mostra a data; ela só se repete aqui quando o talão mostra a parcela. */}
                        <span className={cn('shrink-0', row.installmentNumber === null && 'hidden sm:inline')}>
                          <DateText value={row.occurredOn} /> ·
                        </span>
                        <span className="truncate" title={meta.join(' · ')}>
                          {kindLabel[row.kind]} · <span title={sourceLabel(row)}>{sourceLabel(row)}</span>
                          {row.categoryName ? <> · <span className="text-foreground">{row.categoryName}</span></> : null}
                          {row.memberName ? ` · ${row.memberName}` : null}
                        </span>
                        {/* Descrição crua do banco (crítica 6.5): marca discreta até a edição resumir. */}
                        {bankText ? (
                          <span className="shrink-0 border border-border px-1.5 text-foreground">
                            texto do banco
                            <span className="sr-only">: abra a linha para resumir</span>
                          </span>
                        ) : null}
                      </p>
                    </div>
                  </Canhoto>
                </li>
              );
            })}
          </ul>
        </div>
        );
      })}
    </section>
  );
}
