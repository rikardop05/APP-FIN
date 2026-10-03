'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { TrendingUp } from 'lucide-react';

import { Badge, Button, Money, PageHeader } from '@/components/ui-kit';

import { AccumulationChart } from './accumulation-chart';
import { FeasibilityLine, SurplusSummary } from './feasibility/feasibility';
import {
  feasibleText,
  saveButtonHint,
  visibleConfirmation,
  type SaveEvent,
  formatMonthsToTarget,
  SCENARIO_ORDER,
  scenarioName,
  type ScenarioLabel,
} from './display';
import {
  emptyPlanValues,
  buildCreateBody,
  buildUpdateBody,
  planToValues,
  valuesEqual,
  type FormErrors,
  type PlanFormValues,
} from './form';
import {
  investmentResponseSchema,
  type InvestmentData,
  type InvestmentScenario,
  type InvestmentSurplus,
} from './schemas';

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring';

function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm">
      <label className="font-medium text-foreground" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      {error ? <span className="text-xs text-destructive" role="alert">{error}</span> : null}
    </div>
  );
}

async function readData(response: Response): Promise<InvestmentData> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'Não foi possível concluir a operação.';
    throw new Error(message);
  }
  const parsed = investmentResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('A resposta do servidor está inválida.');
  return parsed.data;
}

/** Avisos permanentes do módulo (RF-INV-01 e RF-INV-03): aparecem em toda visita, sem fechar. */
function Notices() {
  return (
    <div className="mt-4 flex flex-col gap-1 rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm" role="note">
      <p><strong className="font-semibold">Valores em R$ de hoje.</strong> Tudo aqui está no poder de compra de hoje, já descontada a inflação.</p>
      <p className="text-muted-foreground">Retorno passado não é garantia de retorno futuro. Os cenários são hipóteses para planejar, não previsões.</p>
    </div>
  );
}

type PlanFieldsProps = {
  values: PlanFormValues;
  errors: FormErrors;
  onChange: (next: PlanFormValues) => void;
};

function PlanFields({ values, errors, onChange }: PlanFieldsProps) {
  const set = (field: keyof Omit<PlanFormValues, 'scenarios'>) => (event: { target: { value: string } }) =>
    onChange({ ...values, [field]: event.target.value });
  return (
    <div className="flex flex-col gap-4">
      <Field label="Nome do plano" htmlFor="plan-name" error={errors.name}>
        <input id="plan-name" className={inputClass} value={values.name} onChange={set('name')} autoComplete="off" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Renda mensal desejada" htmlFor="plan-income" error={errors.desiredIncome} hint="Quanto você quer receber por mês, em valores de hoje.">
          <input id="plan-income" className={inputClass} value={values.desiredIncome} onChange={set('desiredIncome')} inputMode="decimal" placeholder="R$ 5.000,00" />
        </Field>
        <Field label="Patrimônio atual" htmlFor="plan-portfolio" error={errors.portfolio}>
          <input id="plan-portfolio" className={inputClass} value={values.portfolio} onChange={set('portfolio')} inputMode="decimal" placeholder="R$ 0,00" />
        </Field>
        <Field label="Aporte mensal atual" htmlFor="plan-contribution" error={errors.contribution} hint="Quanto você consegue investir por mês hoje.">
          <input id="plan-contribution" className={inputClass} value={values.contribution} onChange={set('contribution')} inputMode="decimal" placeholder="R$ 0,00" />
        </Field>
        <Field label="Prazo desejado (opcional)" htmlFor="plan-date" error={errors.targetDate}>
          <input id="plan-date" type="date" className={inputClass} value={values.targetDate} onChange={set('targetDate')} />
        </Field>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-foreground">Outras premissas do plano</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="Inflação esperada ao ano (%)" htmlFor="plan-inflation" error={errors.inflation} hint="Só informativa por enquanto: os cálculos já usam retornos reais.">
            <input id="plan-inflation" className={inputClass} value={values.inflation} onChange={set('inflation')} inputMode="decimal" />
          </Field>
          <Field label="Imposto sobre o rendimento (%)" htmlFor="plan-tax" error={errors.tax} hint="Só informativo por enquanto: ainda não entra nos cálculos.">
            <input id="plan-tax" className={inputClass} value={values.tax} onChange={set('tax')} inputMode="decimal" />
          </Field>
        </div>
      </details>
    </div>
  );
}

/**
 * Falha de validação do formulário: o resumo vai para o texto que fica PERTO DO BOTÃO (a
 * mensagem junto do campo pode estar fora da vista, ou dentro de "Outras premissas", fechada),
 * abre o grupo recolhido se o campo está nele e leva a pessoa ao primeiro campo com erro.
 */
function revealInvalidField(focusId: string | null, errors: FormErrors) {
  // Inflação e imposto moram em "Outras premissas" (recolhido): com erro lá, abre o grupo
  // mesmo que o primeiro campo a focar seja outro, senão a mensagem do campo fica invisível.
  if (errors.inflation !== undefined || errors.tax !== undefined) {
    const group = document.getElementById('plan-inflation')?.closest('details');
    if (group) group.open = true;
  }
  if (focusId === null) return;
  const element = document.getElementById(focusId);
  if (element === null) return;
  const details = element.closest('details');
  if (details !== null) details.open = true;
  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  element.focus({ preventScroll: true });
}

function summaryText(messages: string[]): string {
  return `Confira os campos antes de salvar. ${messages.join(' · ')}`;
}

function CreatePlan({ onCreated }: { onCreated: (data: InvestmentData) => void }) {
  const [values, setValues] = useState<PlanFormValues>(() => emptyPlanValues());
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const built = buildCreateBody(values);
    if (!built.ok) {
      setErrors(built.errors);
      setFailure(summaryText(built.messages));
      revealInvalidField(built.focusId, built.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    setFailure(null);
    try {
      const response = await fetch('/api/investment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(built.body),
      });
      onCreated(await readData(response));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Não foi possível criar o plano.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="create-heading" className="mt-6 rounded-lg border border-border bg-card p-4 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <h2 id="create-heading" className="font-semibold">Crie seu plano de renda passiva</h2>
          <p className="text-sm text-muted-foreground">
            Informe a renda que você quer receber, o patrimônio e o aporte de hoje. Mostramos três cenários (conservador, médio e otimista) com as premissas de cada um, que você pode editar depois.
          </p>
        </div>
      </div>
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
        <PlanFields values={values} errors={errors} onChange={setValues} />
        {failure ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{failure}</p> : null}
        <div className="flex justify-end border-t border-border pt-4">
          <Button type="submit" disabled={saving}>{saving ? 'Criando…' : 'Criar plano'}</Button>
        </div>
      </form>
    </section>
  );
}

type ScenarioCardProps = {
  scenario: InvestmentScenario;
  surplus: InvestmentSurplus;
  maxYears: number;
  values: PlanFormValues;
  errors: FormErrors;
  onChange: (next: PlanFormValues) => void;
};

function ScenarioCard({ scenario, surplus, maxYears, values, errors, onChange }: ScenarioCardProps) {
  const label = scenario.label;
  const row = values.scenarios[label];
  const months = formatMonthsToTarget(scenario.result.monthsWithCurrentContribution);
  const setPremise = (field: 'returnPct' | 'withdrawalPct') => (event: { target: { value: string } }) =>
    onChange({ ...values, scenarios: { ...values.scenarios, [label]: { ...row, [field]: event.target.value } } });
  return (
    <article className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:p-5" aria-labelledby={`scenario-${label}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={`scenario-${label}`} className="text-base font-semibold">{scenarioName(label)}</h3>
        <Badge variant={scenario.result.feasible ? 'success' : 'warning'}>{scenario.result.feasible ? 'Viável' : 'Fora do prazo'}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-md bg-secondary/40 p-3">
        <Field label="Retorno real ao ano (%)" htmlFor={`ret-${label}`} error={errors[`${label}.return`]}>
          <input id={`ret-${label}`} className={inputClass} value={row.returnPct} onChange={setPremise('returnPct')} inputMode="decimal" />
        </Field>
        <Field label="Retirada ao ano (%)" htmlFor={`wd-${label}`} error={errors[`${label}.withdrawal`]}>
          <input id={`wd-${label}`} className={inputClass} value={row.withdrawalPct} onChange={setPremise('withdrawalPct')} inputMode="decimal" />
        </Field>
      </div>

      <dl className="flex flex-col gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Patrimônio necessário</dt>
          <dd className="text-lg font-semibold"><Money value={scenario.result.targetPortfolioCents} sign="never" /></dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Tempo para chegar lá com o aporte atual</dt>
          <dd className={months.kind === 'unreachable' || months.kind === 'too-long' ? 'font-medium text-amber-800' : 'font-medium'}>{months.text}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Renda mensal projetada em {maxYears} anos, mantendo o aporte atual</dt>
          <dd className="font-medium"><Money value={scenario.result.projectedIncomeWithCurrentPlanCents} sign="never" /></dd>
        </div>
        <div>
          <dt className="mb-1 text-muted-foreground">Aporte mensal necessário para chegar em</dt>
          <dd>
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {scenario.result.requiredByHorizon.map((item) => (
                <li key={item.years} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                  <span>{item.years} anos</span>
                  <span className="font-medium"><Money value={item.contributionCents} sign="never" /></span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
      <FeasibilityLine scenario={scenario} surplus={surplus} />
      <p className="text-xs text-muted-foreground">{feasibleText(scenario.result.feasible, maxYears)}</p>
    </article>
  );
}

export function InvestmentScreen({ initial }: { initial: InvestmentData }) {
  const [data, setData] = useState<InvestmentData>(initial);
  const [values, setValues] = useState<PlanFormValues>(() =>
    initial.plan === null ? emptyPlanValues() : planToValues(initial.plan, initial.scenarios),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** O que acabou de acontecer (criar/salvar); a confirmação some assim que a pessoa edita. */
  const [saveEvent, setSaveEvent] = useState<SaveEvent | null>(null);

  const saved = data.plan === null ? null : planToValues(data.plan, data.scenarios);
  const dirty = saved !== null && !valuesEqual(saved, values);
  const confirmation = visibleConfirmation(saveEvent, dirty);
  const idleHint = saveButtonHint({ dirty, saving });
  const maxYears = Math.max(0, ...data.horizonsYears);
  const byLabel = new Map(data.scenarios.map((scenario) => [scenario.label, scenario]));
  const ordered = SCENARIO_ORDER.flatMap((label: ScenarioLabel) => {
    const scenario = byLabel.get(label);
    return scenario ? [scenario] : [];
  });

  function accept(next: InvestmentData, event: SaveEvent | null = null) {
    setSaveEvent(event);
    setData(next);
    setValues(next.plan === null ? emptyPlanValues() : planToValues(next.plan, next.scenarios));
    setErrors({});
    setFailure(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const built = buildUpdateBody(values);
    if (!built.ok) {
      setErrors(built.errors);
      setFailure(summaryText(built.messages));
      revealInvalidField(built.focusId, built.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    setFailure(null);
    try {
      const response = await fetch('/api/investment', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(built.body),
      });
      accept(await readData(response), 'saved');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Não foi possível salvar o plano.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Investimentos"
        description="Planejador de renda passiva: quanto juntar, em quanto tempo e quanto aportar por mês, em três cenários."
      />
      <Notices />

      {data.plan === null ? (
        <CreatePlan onCreated={(created) => accept(created, 'created')} />
      ) : (
        <form className="mt-6 flex flex-col gap-6" onSubmit={(event) => void save(event)} noValidate>
          {confirmation ? (
            <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900" role="status">
              {confirmation}
            </p>
          ) : null}

          <section aria-labelledby="plan-heading" className="rounded-lg border border-border bg-card p-4 sm:p-6">
            <h2 id="plan-heading" className="mb-4 font-semibold">Seu plano</h2>
            <PlanFields values={values} errors={errors} onChange={setValues} />
          </section>

          <section aria-labelledby="scenarios-heading" className="flex flex-col gap-3">
            <div>
              <h2 id="scenarios-heading" className="font-semibold">Três cenários</h2>
              <p className="text-sm text-muted-foreground">
                O <strong className="font-medium">retorno real</strong> é o rendimento já descontada a inflação; a <strong className="font-medium">retirada</strong> é a parte do patrimônio que você tira por ano sem consumir o principal. As premissas de cada cenário ficam ao lado do resultado e podem ser editadas.
              </p>
            </div>
            {dirty ? (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
                Você alterou o plano. Os resultados abaixo ainda são os da versão salva: salve para recalcular.
              </p>
            ) : null}
            <SurplusSummary scenarios={ordered} surplus={data.surplus} />
            <div className="grid gap-4 md:grid-cols-3">
              {ordered.map((scenario) => (
                <ScenarioCard key={scenario.label} scenario={scenario} surplus={data.surplus} maxYears={maxYears} values={values} errors={errors} onChange={setValues} />
              ))}
            </div>
          </section>

          {failure ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{failure}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            {idleHint ? <p className="text-sm text-muted-foreground sm:mr-2">{idleHint}</p> : null}
            <Button variant="outline" disabled={!dirty || saving} onClick={() => saved !== null && (setValues(saved), setErrors({}))}>Descartar alterações</Button>
            <Button type="submit" disabled={!dirty || saving}>{saving ? 'Salvando…' : 'Salvar e recalcular'}</Button>
          </div>

          <section aria-labelledby="curves-heading" className="rounded-lg border border-border bg-card p-4 sm:p-6">
            <h2 id="curves-heading" className="font-semibold">Como o patrimônio cresce</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Patrimônio acumulado nos próximos {maxYears} anos, mantendo o aporte atual, em R$ de hoje.
            </p>
            <AccumulationChart scenarios={ordered} />
          </section>
        </form>
      )}
    </>
  );
}
