'use client';

import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import { Button, Input, Money, Select } from '@/components/ui-kit';
import { type Frequency, type IncomeKind } from '@/lib/db';
import { formatDateBR, toCompetence } from '@/lib/date';
import { expandRecurrence, type PlannedOccurrence } from '@/lib/finance/recurrence';
import { cents, formatBRL, parseBRL, type BasisPoints, type Cents } from '@/lib/money';

import {
  IncomeFormSchema,
  RecurringExpenseFormSchema,
  frequencyLabel,
  incomeKindLabel,
  type IncomeFormInput,
  type RecurringExpenseFormInput,
} from './schemas';

// ---------------------------------------------------------------------------
// Tipos do banco consumidos pela tela.
// ---------------------------------------------------------------------------

type RecurringExpenseItem = {
  id: string;
  description: string;
  expectedCents: Cents;
  categoryId: string;
  categoryName: string;
  dueDay: number;
  frequency: Frequency;
  accountId: string | null;
  accountName: string | null;
  creditCardId: string | null;
  creditCardName: string | null;
  startsOn: string;
  endsOn: string | null;
  annualAdjustmentBp: number | null;
  active: boolean;
};

type IncomeItem = {
  id: string;
  description: string;
  kind: IncomeKind;
  expectedCents: Cents;
  memberId: string;
  memberName: string;
  accountId: string;
  accountName: string;
  receiveDay: number;
  frequency: Frequency;
  oneOffCompetence: string | null;
  startsOn: string | null;
  endsOn: string | null;
  active: boolean;
};

type RecurringOptions = {
  categories: { id: string; name: string; parentId: string | null; nature: 'essential' | 'non_essential' | 'investment' | 'income' }[];
  accounts: { id: string; name: string }[];
  cards: { id: string; name: string }[];
};

type IncomeOptions = {
  members: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
};

type RecurringScreenProps = {
  today: string;
  /**
   * Horizonte do preview de ocorrências. Vem de `household_settings.projection_months`
   * (T-115 fix: a tela não chumba em 12). Usado pelo `OccurrencesPreview`
   * dentro dos diálogos de edição e pela lista de regras existentes.
   */
  previewMonths: number;
  expenses: RecurringExpenseItem[];
  incomes: IncomeItem[];
  recurringOptions: RecurringOptions;
  incomeOptions: IncomeOptions;
};

const FREQUENCY_OPTIONS: Frequency[] = [
  'monthly',
  'bimonthly',
  'quarterly',
  'semiannual',
  'annual',
  'one_off',
];

const INCOME_KIND_OPTIONS: IncomeKind[] = [
  'salary',
  'pro_labore',
  'variable',
  'rent',
  'other',
];

// ---------------------------------------------------------------------------
// Preview de ocorrências — consome `expandRecurrence` (T-201, Esquadro).
// A tela NAO calcula calendário; passa os campos DECLARADOS pelo formulário
// para o motor, que devolve as próximas N ocorrências previstas.
// ---------------------------------------------------------------------------

function OccurrencesPreview({
  title,
  expectedCents,
  dueDay,
  frequency,
  startsOn,
  endsOn,
  annualAdjustmentBp,
  today,
  oneOffCompetence,
  previewMonths,
}: {
  title: string;
  expectedCents: Cents;
  dueDay: number;
  frequency: Frequency;
  startsOn: string;
  endsOn: string | null;
  annualAdjustmentBp: BasisPoints | null;
  today: string;
  oneOffCompetence?: string | null;
  previewMonths: number;
}) {
  const fromCompetence = toCompetence(today);
  const occurrences = expandRecurrence(
    {
      expectedCents,
      dueDay,
      frequency,
      startsOn,
      endsOn,
      annualAdjustmentBp,
      oneOffCompetence: oneOffCompetence ?? null,
    },
    { from: fromCompetence, months: previewMonths },
  );

  return (
    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
      <p className="text-xs font-medium text-amber-900">
        {title} — previsto, ainda não realizado.
      </p>
      {occurrences.length === 0 ? (
        <p className="mt-1 text-xs text-amber-900/80">
          Sem ocorrências previstas na janela dos próximos 12 meses.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {occurrences.map((occurrence: PlannedOccurrence) => (
            <li
              key={occurrence.competence}
              className="flex items-center justify-between text-xs tabular"
            >
              <span className="text-amber-950">
                {formatDateBR(occurrence.date)} · {occurrence.competence}
              </span>
              <Money value={occurrence.amountCents} sign="never" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog compartilhado entre despesa e receita — minimiza código duplicado.
// ---------------------------------------------------------------------------

type DialogShellProps = {
  title: string;
  description: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
  submitLabel: string;
};

function DialogShell({
  title,
  description,
  busy,
  error,
  onClose,
  onSubmit,
  children,
  submitLabel,
}: DialogShellProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/20 p-0 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-lg border border-border bg-background p-4 shadow-lg sm:max-w-2xl sm:rounded-lg sm:p-6"
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <Button variant="ghost" size="sm" aria-label="Fechar" onClick={onClose}>
            Fechar
          </Button>
        </div>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          {children}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Salvando…' : submitLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulário de despesa fixa.
// ---------------------------------------------------------------------------

function ExpenseDialog({
  initial,
  options,
  today,
  previewMonths,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  initial: RecurringExpenseFormInput | null;
  options: RecurringOptions;
  today: string;
  previewMonths: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: RecurringExpenseFormInput) => Promise<void>;
}) {
  const [values, setValues] = useState<RecurringExpenseFormInput>(
    initial ?? {
      description: '',
      amountInput: '',
      categoryId: options.categories[0]?.id ?? '',
      dueDay: '5',
      frequency: 'monthly',
      accountId: options.accounts[0]?.id ?? null,
      creditCardId: null,
      startsOn: today,
      endsOn: null,
      annualAdjustmentBp: '',
    },
  );
  const [showPreview, setShowPreview] = useState(false);

  function update<K extends keyof RecurringExpenseFormInput>(
    key: K,
    value: RecurringExpenseFormInput[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  // Recalcula o preview com o motor — sem calcular calendário na tela.
  const previewExpected = (() => {
    const parsed = parseBRL(values.amountInput);
    if (parsed === null || parsed === 0) return null;
    // Banco guarda saida como negativo.
    const sign = parsed > 0 ? -1 : 1;
    return cents(parsed * sign);
  })();
  const previewStart = values.startsOn || today;
  const previewReady =
    previewExpected !== null &&
    previewStart.length === 10 &&
    Number(values.dueDay) >= 1 &&
    Number(values.dueDay) <= 31;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = RecurringExpenseFormSchema.safeParse(values);
    if (!parsed.success) {
      return;
    }
    await onSubmit(parsed.data);
  }

  return (
    <DialogShell
      title={initial ? 'Editar despesa fixa' : 'Nova despesa fixa'}
      description={`Vencimento no \`dueDay\` a partir de \`startsOn\`. Janela de ${String(previewMonths)} meses no preview abaixo.`}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={submit}
      submitLabel={initial ? 'Salvar alterações' : 'Criar despesa fixa'}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="text-xs text-muted-foreground">Descrição</span>
          <Input
            value={values.description}
            onChange={(event) => update('description', event.target.value)}
            placeholder="Ex.: Aluguel"
            maxLength={240}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Valor mensal</span>
          <Input
            value={values.amountInput}
            onChange={(event) => update('amountInput', event.target.value)}
            placeholder="R$ 0,00"
            inputMode="decimal"
            required
          />
          <span className="text-xs text-muted-foreground">
            Use valor positivo. Saída é negativa no banco.
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Dia de vencimento</span>
          <Input
            type="number"
            min={1}
            max={31}
            value={values.dueDay}
            onChange={(event) => update('dueDay', event.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Frequência</span>
          <Select
            value={values.frequency}
            onChange={(event) =>
              update('frequency', event.target.value as RecurringExpenseFormInput['frequency'])
            }
          >
            {FREQUENCY_OPTIONS.map((frequency) => (
              <option key={frequency} value={frequency}>
                {frequencyLabel(frequency)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Categoria (folha)</span>
          <Select
            value={values.categoryId}
            onChange={(event) => update('categoryId', event.target.value)}
            required
          >
            {options.categories.length === 0 ? (
              <option value="">Sem categoria-folha cadastrada</option>
            ) : (
              options.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))
            )}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Conta</span>
          <Select
            value={values.accountId ?? ''}
            onChange={(event) => {
              update('accountId', event.target.value || null);
              update('creditCardId', null);
            }}
          >
            <option value="">—</option>
            {options.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Cartão</span>
          <Select
            value={values.creditCardId ?? ''}
            onChange={(event) => {
              update('creditCardId', event.target.value || null);
              update('accountId', null);
            }}
          >
            <option value="">—</option>
            {options.cards.map((card) => (
              <option key={card.id} value={card.id}>
                {card.name}
              </option>
            ))}
          </Select>
          <span className="text-xs text-muted-foreground">
            Escolha a conta OU o cartão de onde a despesa sai.
          </span>
        </label>
        {options.accounts.length === 0 && options.cards.length === 0 ? (
          <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm sm:col-span-2">
            Não há conta nem cartão ativo. Cadastre uma conta antes de criar uma despesa fixa.
          </p>
        ) : null}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Data inicial</span>
          <Input
            type="date"
            value={values.startsOn}
            onChange={(event) => update('startsOn', event.target.value)}
            required
          />
          <span className="text-xs text-muted-foreground">
            Piso. A 1ª ocorrência é o 1º `dueDay` em ou depois desta data.
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Data final (opcional)</span>
          <Input
            type="date"
            value={values.endsOn ?? ''}
            onChange={(event) => update('endsOn', event.target.value || null)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Reajuste anual (bp, opcional)</span>
          <Input
            type="number"
            value={values.annualAdjustmentBp ?? ''}
            onChange={(event) =>
              update('annualAdjustmentBp', event.target.value === '' ? '' : event.target.value)
            }
            placeholder="500 = 5,00 %"
          />
        </label>
      </div>
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowPreview((current) => !current)}
          disabled={!previewReady}
        >
          {showPreview ? 'Ocultar ocorrências previstas' : 'Ver ocorrências previstas'}
        </Button>
        {showPreview && previewReady && previewExpected !== null ? (
          <OccurrencesPreview
            title={`Próximas ${previewMonths} ocorrências`}
            expectedCents={previewExpected}
            dueDay={Number(values.dueDay)}
            frequency={values.frequency}
            startsOn={previewStart}
            endsOn={values.endsOn}
            annualAdjustmentBp={
              values.annualAdjustmentBp === null || values.annualAdjustmentBp === ''
                ? null
                : (Number(values.annualAdjustmentBp) as unknown as BasisPoints)
            }
            today={today}
            previewMonths={previewMonths}
          />
        ) : null}
      </div>
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// Formulário de receita.
// ---------------------------------------------------------------------------

function IncomeDialog({
  initial,
  options,
  today,
  previewMonths,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  initial: IncomeFormInput | null;
  options: IncomeOptions;
  today: string;
  previewMonths: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: IncomeFormInput) => Promise<void>;
}) {
  const [values, setValues] = useState<IncomeFormInput>(
    initial ?? {
      description: '',
      amountInput: '',
      kind: 'salary',
      memberId: options.members[0]?.id ?? '',
      accountId: options.accounts[0]?.id ?? '',
      receiveDay: '5',
      frequency: 'monthly',
      oneOffCompetence: null,
      startsOn: today,
      endsOn: null,
    },
  );
  const [showPreview, setShowPreview] = useState(false);

  function update<K extends keyof IncomeFormInput>(key: K, value: IncomeFormInput[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  const previewExpected = (() => {
    const parsed = parseBRL(values.amountInput);
    if (parsed === null || parsed === 0) return null;
    // Receita é entrada: deve ser positiva.
    return cents(Math.abs(parsed));
  })();
  const previewStart = values.startsOn ?? today;
  const previewReady =
    previewExpected !== null &&
    previewStart.length === 10 &&
    Number(values.receiveDay) >= 1 &&
    Number(values.receiveDay) <= 31;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = IncomeFormSchema.safeParse(values);
    if (!parsed.success) return;
    await onSubmit(parsed.data);
  }

  return (
    <DialogShell
      title={initial ? 'Editar receita' : 'Nova receita'}
      description="Recebimento no `receiveDay` a partir de `startsOn`. Para 13º, use `one_off` com competência fixa."
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={submit}
      submitLabel={initial ? 'Salvar alterações' : 'Criar receita'}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="text-xs text-muted-foreground">Descrição</span>
          <Input
            value={values.description}
            onChange={(event) => update('description', event.target.value)}
            placeholder="Ex.: Salário"
            maxLength={240}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Valor</span>
          <Input
            value={values.amountInput}
            onChange={(event) => update('amountInput', event.target.value)}
            placeholder="R$ 0,00"
            inputMode="decimal"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Tipo</span>
          <Select
            value={values.kind}
            onChange={(event) =>
              update('kind', event.target.value as IncomeFormInput['kind'])
            }
          >
            {INCOME_KIND_OPTIONS.map((kind) => (
              <option key={kind} value={kind}>
                {incomeKindLabel(kind)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Responsável</span>
          <Select
            value={values.memberId}
            onChange={(event) => update('memberId', event.target.value)}
            required
          >
            {options.members.length === 0 ? (
              <option value="">Sem membros cadastrados</option>
            ) : (
              options.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))
            )}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Conta onde cai</span>
          <Select
            value={values.accountId}
            onChange={(event) => update('accountId', event.target.value)}
            required
          >
            {options.accounts.length === 0 ? (
              <option value="">Sem conta ativa</option>
            ) : (
              options.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))
            )}
          </Select>
        </label>
        {options.accounts.length === 0 ? (
          <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm sm:col-span-2">
            Não há conta ativa. Cadastre uma conta antes de criar uma receita: ela precisa cair
            em algum lugar para entrar no saldo e no fluxo de caixa.
          </p>
        ) : null}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Dia de recebimento</span>
          <Input
            type="number"
            min={1}
            max={31}
            value={values.receiveDay}
            onChange={(event) => update('receiveDay', event.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Frequência</span>
          <Select
            value={values.frequency}
            onChange={(event) =>
              update('frequency', event.target.value as IncomeFormInput['frequency'])
            }
          >
            {FREQUENCY_OPTIONS.map((frequency) => (
              <option key={frequency} value={frequency}>
                {frequencyLabel(frequency)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Início (opcional para não-eventual)</span>
          <Input
            type="date"
            value={values.startsOn ?? ''}
            onChange={(event) => update('startsOn', event.target.value || null)}
          />
          <span className="text-xs text-muted-foreground">
            Piso. A 1ª ocorrência é o 1º `receiveDay` em ou depois desta data.
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Fim (opcional)</span>
          <Input
            type="date"
            value={values.endsOn ?? ''}
            onChange={(event) => update('endsOn', event.target.value || null)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Competência fixa (só para `one_off`)</span>
          <Input
            type="month"
            value={values.oneOffCompetence ?? ''}
            onChange={(event) =>
              update('oneOffCompetence', event.target.value || null)
            }
            disabled={values.frequency !== 'one_off'}
          />
          <span className="text-xs text-muted-foreground">
            Habilitada só para receita eventual (13º, PLR).
          </span>
        </label>
      </div>
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowPreview((current) => !current)}
          disabled={!previewReady}
        >
          {showPreview ? 'Ocultar ocorrências previstas' : 'Ver ocorrências previstas'}
        </Button>
        {showPreview && previewReady && previewExpected !== null ? (
          <OccurrencesPreview
            title={`Próximas ${previewMonths} ocorrências`}
            expectedCents={previewExpected}
            dueDay={Number(values.receiveDay)}
            frequency={values.frequency}
            startsOn={previewStart}
            endsOn={values.endsOn}
            annualAdjustmentBp={null}
            today={today}
            oneOffCompetence={values.oneOffCompetence}
            previewMonths={previewMonths}
          />
        ) : null}
      </div>
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// Cartão de item na lista (despesa ou receita).
// ---------------------------------------------------------------------------

function ItemCard({
  children,
  onEdit,
  onDelete,
  busy,
}: {
  children: React.ReactNode;
  onEdit: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  return (
    <article className="rounded-lg border border-border bg-background p-4">
      {children}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onEdit}
          disabled={busy}
        >
          <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Editar
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDelete}
          disabled={busy}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Desativar
        </Button>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Tela principal — composição de despesas fixas e receitas.
// ---------------------------------------------------------------------------

export function RecurringScreen({
  today,
  previewMonths,
  expenses,
  incomes,
  recurringOptions,
  incomeOptions,
}: RecurringScreenProps) {
  const [expenseList, setExpenseList] = useState(expenses);
  const [incomeList, setIncomeList] = useState(incomes);
  const [editingExpense, setEditingExpense] = useState<RecurringExpenseItem | null>(null);
  const [editingIncome, setEditingIncome] = useState<IncomeItem | null>(null);
  const [creatingExpense, setCreatingExpense] = useState(false);
  const [creatingIncome, setCreatingIncome] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<string | null>(null);

  async function submitExpense(values: RecurringExpenseFormInput): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const amountParsed = parseBRL(values.amountInput);
      if (amountParsed === null || amountParsed === 0) {
        setError('Informe um valor válido.');
        return;
      }
      const expectedCents = cents(-Math.abs(amountParsed));
      const annualAdjustmentBp =
        values.annualAdjustmentBp === null || values.annualAdjustmentBp === ''
          ? null
          : Number(values.annualAdjustmentBp);
      // O que vai no banco: `dueDay: number`, `annualAdjustmentBp: BasisPoints`.
      // O que vai pra API (Zod coerce): strings (saem do DOM) → coercidas pelo schema.
      const body = {
        description: values.description,
        expectedCents,
        categoryId: values.categoryId,
        dueDay: Number(values.dueDay),
        frequency: values.frequency,
        accountId: values.accountId,
        creditCardId: values.creditCardId,
        startsOn: values.startsOn,
        endsOn: values.endsOn,
        annualAdjustmentBp,
      };
      const response = await fetch(
        editingExpense ? `/api/recurring/${editingExpense.id}` : '/api/recurring',
        {
          method: editingExpense ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const parsed = await response.json().catch(() => null);
        const message =
          parsed && typeof parsed === 'object' && 'error' in parsed
            ? String(parsed.error)
            : 'Não foi possível salvar a despesa fixa.';
        setError(message);
        return;
      }
      const saved = (await response.json()) as { id: string };
      // `values` ainda tem strings; o upsert converte para number com `Number()`.
      setExpenseList((current) =>
        upsertExpense(current, saved.id, values, expectedCents, annualAdjustmentBp),
      );
      setEditingExpense(null);
      setCreatingExpense(false);
      setDeleted(null);
    } finally {
      setBusy(false);
    }
  }

  async function submitIncome(values: IncomeFormInput): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const amountParsed = parseBRL(values.amountInput);
      if (amountParsed === null || amountParsed === 0) {
        setError('Informe um valor válido.');
        return;
      }
      const expectedCents = cents(Math.abs(amountParsed));
      const body = {
        description: values.description,
        expectedCents,
        kind: values.kind,
        memberId: values.memberId,
        accountId: values.accountId,
        receiveDay: Number(values.receiveDay),
        frequency: values.frequency,
        oneOffCompetence: values.oneOffCompetence,
        startsOn: values.startsOn,
        endsOn: values.endsOn,
      };
      const response = await fetch(
        editingIncome ? `/api/incomes/${editingIncome.id}` : '/api/incomes',
        {
          method: editingIncome ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const parsed = await response.json().catch(() => null);
        const message =
          parsed && typeof parsed === 'object' && 'error' in parsed
            ? String(parsed.error)
            : 'Não foi possível salvar a receita.';
        setError(message);
        return;
      }
      const saved = (await response.json()) as { id: string };
      setIncomeList((current) =>
        upsertIncome(current, saved.id, values, expectedCents, incomeOptions.accounts),
      );
      setEditingIncome(null);
      setCreatingIncome(false);
      setDeleted(null);
    } finally {
      setBusy(false);
    }
  }

  async function deactivateExpense(id: string) {
    if (!confirm('Desativar esta despesa fixa? As ocorrências previstas somem, mas o histórico fica.')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/recurring/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        setError('Não foi possível desativar a despesa fixa.');
        return;
      }
      setExpenseList((current) =>
        current.map((item) => (item.id === id ? { ...item, active: false } : item)),
      );
      setDeleted(id);
    } finally {
      setBusy(false);
    }
  }

  async function deactivateIncome(id: string) {
    if (!confirm('Desativar esta receita? As ocorrências previstas somem, mas o histórico fica.')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/incomes/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        setError('Não foi possível desativar a receita.');
        return;
      }
      setIncomeList((current) =>
        current.map((item) => (item.id === id ? { ...item, active: false } : item)),
      );
      setDeleted(id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error && !creatingExpense && !editingExpense && !creatingIncome && !editingIncome ? (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </div>
      ) : null}
      {deleted ? (
        <div role="status" className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          Item desativado. As ocorrências previstas não aparecem mais no fluxo de caixa.
        </div>
      ) : null}

      <section
        aria-labelledby="recurring-expenses-heading"
        className="flex flex-col gap-3"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="recurring-expenses-heading" className="text-base font-semibold text-foreground">
            Despesas fixas
          </h2>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setCreatingExpense(true);
              setError(null);
            }}
            disabled={busy}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Nova despesa fixa
          </Button>
        </div>
        {expenseList.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
            Nenhuma despesa fixa cadastrada.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {expenseList.map((expense) => (
              <li key={expense.id}>
                <ItemCard
                  busy={busy}
                  onEdit={() => {
                    setEditingExpense(expense);
                    setError(null);
                  }}
                  onDelete={() => void deactivateExpense(expense.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-foreground">
                        {expense.description}{' '}
                        {!expense.active ? (
                          <span className="ml-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                            Inativa
                          </span>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {expense.categoryName} · dia {expense.dueDay} ·{' '}
                        {frequencyLabel(expense.frequency)}
                        {expense.accountName ? ` · ${expense.accountName}` : ''}
                        {expense.creditCardName ? ` · ${expense.creditCardName}` : ''}
                      </span>
                    </div>
                    <Money
                      value={expense.expectedCents}
                      sign="never"
                      className="text-sm font-semibold"
                    />
                  </div>
                  {expense.active ? (
                    <OccurrencesPreview
                      title={`Próximas ${previewMonths} ocorrências`}
                      expectedCents={expense.expectedCents}
                      dueDay={expense.dueDay}
                      frequency={expense.frequency}
                      startsOn={expense.startsOn}
                      endsOn={expense.endsOn}
                      annualAdjustmentBp={
                        expense.annualAdjustmentBp === null
                          ? null
                          : (expense.annualAdjustmentBp as unknown as BasisPoints)
                      }
                      today={today}
                      previewMonths={previewMonths}
                    />
                  ) : null}
                </ItemCard>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="recurring-incomes-heading"
        className="flex flex-col gap-3"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="recurring-incomes-heading" className="text-base font-semibold text-foreground">
            Receitas
          </h2>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setCreatingIncome(true);
              setError(null);
            }}
            disabled={busy}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Nova receita
          </Button>
        </div>
        {incomeList.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
            Nenhuma receita cadastrada.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {incomeList.map((income) => (
              <li key={income.id}>
                <ItemCard
                  busy={busy}
                  onEdit={() => {
                    setEditingIncome(income);
                    setError(null);
                  }}
                  onDelete={() => void deactivateIncome(income.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-foreground">
                        {income.description}{' '}
                        {!income.active ? (
                          <span className="ml-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                            Inativa
                          </span>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {incomeKindLabel(income.kind)} · {income.memberName} · dia{' '}
                        {income.receiveDay} · {frequencyLabel(income.frequency)}
                        {income.oneOffCompetence
                          ? ` · competência ${income.oneOffCompetence}`
                          : ''}
                      </span>
                    </div>
                    <Money
                      value={income.expectedCents}
                      sign="never"
                      className="text-sm font-semibold"
                    />
                  </div>
                  {income.active ? (
                    <OccurrencesPreview
                      title={`Próximas ${previewMonths} ocorrências`}
                      expectedCents={income.expectedCents}
                      dueDay={income.receiveDay}
                      frequency={income.frequency}
                      startsOn={income.startsOn ?? today}
                      endsOn={income.endsOn}
                      annualAdjustmentBp={null}
                      today={today}
                      oneOffCompetence={income.oneOffCompetence}
                      previewMonths={previewMonths}
                    />
                  ) : null}
                </ItemCard>
              </li>
            ))}
          </ul>
        )}
      </section>

      {creatingExpense ? (
        <ExpenseDialog
          initial={null}
          options={recurringOptions}
          today={today}
          previewMonths={previewMonths}
          busy={busy}
          error={error}
          onClose={() => {
            setCreatingExpense(false);
            setError(null);
          }}
          onSubmit={submitExpense}
        />
      ) : null}

      {editingExpense ? (
        <ExpenseDialog
          initial={expenseToFormInput(editingExpense)}
          options={recurringOptions}
          today={today}
          previewMonths={previewMonths}
          busy={busy}
          error={error}
          onClose={() => {
            setEditingExpense(null);
            setError(null);
          }}
          onSubmit={submitExpense}
        />
      ) : null}

      {creatingIncome ? (
        <IncomeDialog
          initial={null}
          options={incomeOptions}
          today={today}
          previewMonths={previewMonths}
          busy={busy}
          error={error}
          onClose={() => {
            setCreatingIncome(false);
            setError(null);
          }}
          onSubmit={submitIncome}
        />
      ) : null}

      {editingIncome ? (
        <IncomeDialog
          initial={incomeToFormInput(editingIncome)}
          options={incomeOptions}
          today={today}
          previewMonths={previewMonths}
          busy={busy}
          error={error}
          onClose={() => {
            setEditingIncome(null);
            setError(null);
          }}
          onSubmit={submitIncome}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers de transformação entre o tipo do banco e o formulário.
// ---------------------------------------------------------------------------

function expenseToFormInput(expense: RecurringExpenseItem): RecurringExpenseFormInput {
  return {
    description: expense.description,
    amountInput: formatBRLForInput(expense.expectedCents),
    categoryId: expense.categoryId,
    dueDay: String(expense.dueDay),
    frequency: expense.frequency,
    accountId: expense.accountId,
    creditCardId: expense.creditCardId,
    startsOn: expense.startsOn,
    endsOn: expense.endsOn,
    annualAdjustmentBp:
      expense.annualAdjustmentBp === null ? '' : String(expense.annualAdjustmentBp),
  };
}

function incomeToFormInput(income: IncomeItem): IncomeFormInput {
  return {
    description: income.description,
    amountInput: formatBRLForInput(income.expectedCents),
    kind: income.kind,
    memberId: income.memberId,
    accountId: income.accountId,
    receiveDay: String(income.receiveDay),
    frequency: income.frequency,
    oneOffCompetence: income.oneOffCompetence,
    startsOn: income.startsOn,
    endsOn: income.endsOn,
  };
}

function formatBRLForInput(value: Cents): string {
  // Para despesa (negativa) ou receita (positiva): o usuário digita positivo,
  // o form nega antes de enviar — então invertemos o sinal ao carregar.
  const absolute = value < 0 ? -value : value;
  // `formatBRL` aceita `Cents` e devolve a string pt-BR com `R$ `. Para INPUT
  // queremos só o número (sem o prefixo) para ficar mais limpo na tela.
  return formatBRL(cents(absolute)).replace(/^R\$\s*/, '').trim();
}

function upsertExpense(
  current: RecurringExpenseItem[],
  id: string,
  values: RecurringExpenseFormInput,
  expectedCents: Cents,
  annualAdjustmentBp: number | null,
): RecurringExpenseItem[] {
  const category = current
    .map((item) => item)
    .concat([])
    .find((item) => item.categoryId === values.categoryId);
  const account = current
    .map((item) => item)
    .concat([])
    .find((item) => item.accountId !== null && item.accountId === values.accountId);
  const card = current
    .map((item) => item)
    .concat([])
    .find((item) => item.creditCardId !== null && item.creditCardId === values.creditCardId);
  const next: RecurringExpenseItem = {
    id,
    description: values.description.trim(),
    expectedCents,
    categoryId: values.categoryId,
    categoryName: category?.categoryName ?? '',
    dueDay: Number(values.dueDay),
    frequency: values.frequency,
    accountId: values.accountId,
    accountName: values.accountId === null ? null : account?.accountName ?? null,
    creditCardId: values.creditCardId,
    creditCardName: values.creditCardId === null ? null : card?.creditCardName ?? null,
    startsOn: values.startsOn,
    endsOn: values.endsOn,
    annualAdjustmentBp,
    active: true,
  };
  const existing = current.findIndex((item) => item.id === id);
  if (existing === -1) return [...current, next];
  const copy = current.slice();
  copy[existing] = next;
  return copy;
}

function upsertIncome(
  current: IncomeItem[],
  id: string,
  values: IncomeFormInput,
  expectedCents: Cents,
  accounts: IncomeOptions['accounts'],
): IncomeItem[] {
  const member = current
    .map((item) => item)
    .concat([])
    .find((item) => item.memberId === values.memberId);
  const next: IncomeItem = {
    id,
    description: values.description.trim(),
    kind: values.kind,
    expectedCents,
    memberId: values.memberId,
    memberName: member?.memberName ?? '',
    accountId: values.accountId,
    accountName: accounts.find((account) => account.id === values.accountId)?.name ?? '',
    receiveDay: Number(values.receiveDay),
    frequency: values.frequency,
    oneOffCompetence: values.oneOffCompetence,
    startsOn: values.startsOn,
    endsOn: values.endsOn,
    active: true,
  };
  const existing = current.findIndex((item) => item.id === id);
  if (existing === -1) return [...current, next];
  const copy = current.slice();
  copy[existing] = next;
  return copy;
}
