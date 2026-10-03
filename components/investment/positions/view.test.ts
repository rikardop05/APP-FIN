import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';

import type { ComparisonEntry, PositionsData, Snapshot } from './schemas';
import {
  adherenceSummaryText,
  buildMonthRows,
  buildSnapshotBody,
  comparisonFor,
  comparisonLines,
  confirmationText,
  deleteQuestion,
  emptySnapshotValues,
  eventAfterSave,
  firstSnapshotErrorId,
  isCurrentPortfolio,
  snapshotErrorSummary,
  snapshotToValues,
  sortSnapshots,
  applyToPlanQuestion,
} from './view';

const TODAY = '2026-10-03';
const pct = (bp: number) => `${String(bp / 100).replace('.', ',')}%`;

function contributions(): PositionsData['contributions'] {
  // 13 meses: 2025-10 .. 2026-10.
  const months: string[] = [];
  for (let m = 10; m <= 12; m += 1) months.push(`2025-${String(m)}`);
  for (let m = 1; m <= 10; m += 1) months.push(`2026-${String(m).padStart(2, '0')}`);
  return months.map((competence) => ({ competence, actualCents: cents(0) }));
}

describe('linhas do aporte efetivo x planejado', () => {
  const base = contributions();
  base[10] = { competence: '2026-08', actualCents: cents(30_000) };
  const data: Pick<PositionsData, 'contributions' | 'adherence' | 'plan' | 'currentCompetence'> = {
    currentCompetence: '2026-10',
    plan: { plannedMonthlyCents: cents(50_000), currentPortfolioCents: cents(1_000_000), startCompetence: '2026-08', currentPortfolioAsOf: '2026-08-31' },
    contributions: base,
    adherence: {
      months: [
        { competence: '2026-08', actualCents: cents(30_000), plannedCents: cents(50_000), adherenceBp: 6000 as never, belowPlan: true, inProgress: false },
        { competence: '2026-09', actualCents: cents(0), plannedCents: cents(50_000), adherenceBp: 0 as never, belowPlan: true, inProgress: false },
        { competence: '2026-10', actualCents: cents(10_000), plannedCents: cents(50_000), adherenceBp: 2000 as never, belowPlan: true, inProgress: true },
      ],
      summary: { closedMonths: 2, averageAdherenceBp: 3000 as never, monthsBelowPlan: 2 },
    },
  };

  it('mostra os 13 meses; antes da âncora do plano é "before_plan", sem aderência', () => {
    const rows = buildMonthRows(data);
    expect(rows).toHaveLength(13);
    expect(rows[0]).toMatchObject({ competence: '2025-10', label: 'out/2025', state: 'before_plan', adherenceBp: null, barBp: null });
    expect(rows[9]).toMatchObject({ competence: '2026-07', state: 'before_plan' });
  });

  it('mês com aporte 0 é dado: linha existe com R$ 0,00 e aderência 0%', () => {
    const sep = buildMonthRows(data).find((row) => row.competence === '2026-09');
    expect(sep).toMatchObject({ state: 'tracked', actualCents: 0, adherenceBp: 0, barBp: 0, belowPlan: true, inProgress: false });
  });

  it('o mês corrente sai "em andamento"', () => {
    const rows = buildMonthRows(data);
    expect(rows.at(-1)).toMatchObject({ competence: '2026-10', inProgress: true, state: 'tracked' });
    expect(rows.filter((row) => row.inProgress)).toHaveLength(1);
  });

  it('a barra é limitada a 100% (aporte acima do planejado não passa da borda)', () => {
    const over = {
      ...data,
      adherence: {
        ...data.adherence!,
        months: [{ competence: '2026-08', actualCents: cents(90_000), plannedCents: cents(50_000), adherenceBp: 18_000 as never, belowPlan: false, inProgress: false }],
      },
    };
    expect(buildMonthRows(over).find((row) => row.competence === '2026-08')?.barBp).toBe(10_000);
  });

  it('sem plano: todos os meses são "no_plan", só o efetivo, e o corrente continua marcado', () => {
    const rows = buildMonthRows({ ...data, plan: null, adherence: null });
    expect(rows.every((row) => row.state === 'no_plan' && row.adherenceBp === null && row.plannedCents === null)).toBe(true);
    expect(rows.at(-1)?.inProgress).toBe(true);
    expect(rows[10]?.actualCents).toBe(30_000);
  });
});

describe('resumo da aderência', () => {
  const summary = (closedMonths: number, average: number | null, below: number): PositionsData['adherence'] => ({
    months: [],
    summary: { closedMonths, averageAdherenceBp: average as never, monthsBelowPlan: below },
  });

  it('N de M meses abaixo do planejado, com a aderência média', () => {
    expect(adherenceSummaryText(summary(2, 3000, 2), pct)).toEqual({
      headline: '2 de 2 meses fechados abaixo do planejado.',
      detail: 'Aderência média: 30%.',
    });
    expect(adherenceSummaryText(summary(5, 9000, 1), pct)?.headline).toBe('1 de 5 meses fechados abaixo do planejado.');
  });

  it('nenhum abaixo e singular de "mês"', () => {
    expect(adherenceSummaryText(summary(3, 10_500, 0), pct)?.headline).toBe('Nenhum dos 3 meses fechados ficou abaixo do planejado.');
    expect(adherenceSummaryText(summary(1, 10_000, 0), pct)?.headline).toBe('O único mês fechado não ficou abaixo do planejado.');
    expect(adherenceSummaryText(summary(1, 2000, 1), pct)?.headline).toBe('1 de 1 mês fechado abaixo do planejado.');
  });

  it('sem mês fechado, sem planejado e sem plano: diz a ausência, não inventa número', () => {
    expect(adherenceSummaryText(summary(0, null, 0), pct)).toEqual({
      headline: 'Ainda não há mês fechado desde o início do plano.',
      detail: null,
    });
    expect(adherenceSummaryText(summary(3, null, 0), pct)?.headline).toBe('Sem aporte planejado: a aderência não é calculada.');
    expect(adherenceSummaryText(null, pct)).toBeNull();
  });
});

describe('comparação com os cenários', () => {
  const entry = (overrides: Partial<ComparisonEntry>): ComparisonEntry => ({
    asOf: '2026-09-30',
    competence: '2026-09',
    portfolioCents: cents(1_200_000),
    status: 'compared',
    byScenario: [
      { label: 'conservative', projectedCents: cents(1_000_000), diffCents: cents(200_000), diffBp: 2000 as never },
      { label: 'moderate', projectedCents: cents(1_250_000), diffCents: cents(-50_000), diffBp: -400 as never },
      { label: 'optimistic', projectedCents: cents(1_200_000), diffCents: cents(0), diffBp: 0 as never },
    ],
    ...overrides,
  });

  it('à frente, atrás e igual, com o projetado, um texto por cenário', () => {
    const lines = comparisonLines(entry({}));
    expect(lines.map((line) => line.tone)).toEqual(['ahead', 'behind', 'even']);
    expect(lines[0]).toEqual({ label: 'Conservador', tone: 'ahead', text: 'R$ 2.000,00 à frente do cenário conservador (projetado R$ 10.000,00).' });
    expect(lines[1]?.text).toBe('R$ 500,00 atrás do cenário médio (projetado R$ 12.500,00).');
    expect(lines[2]?.text).toBe('Igual ao cenário otimista (projetado R$ 12.000,00).');
  });

  it('antes do plano e além da projeção: uma linha explicando, sem número', () => {
    expect(comparisonLines(entry({ status: 'before_plan' }))).toEqual([
      { label: '', text: 'Antes do plano: sem comparação com a projeção.', tone: 'none' },
    ]);
    expect(comparisonLines(entry({ status: 'beyond_curve' }))[0]?.text).toBe('Além da projeção: sem comparação.');
  });

  it('cenário sem projeção naquela data não vira zero', () => {
    const lines = comparisonLines(
      entry({ byScenario: [{ label: 'moderate', projectedCents: null, diffCents: null, diffBp: null }] }),
    );
    expect(lines).toEqual([{ label: 'Médio', tone: 'none', text: 'Sem projeção do cenário médio para esta data.' }]);
  });

  it('sem comparação (sem plano): nenhuma linha', () => {
    expect(comparisonLines(undefined)).toEqual([]);
  });

  it('casa o registro com a comparação pela data', () => {
    const snapshot: Snapshot = { id: '11111111-1111-4111-8111-111111111111', asOf: '2026-09-30', portfolioCents: cents(1_200_000), note: null };
    expect(comparisonFor({ comparison: [entry({})] }, snapshot)?.asOf).toBe('2026-09-30');
    expect(comparisonFor({ comparison: null }, snapshot)).toBeUndefined();
    expect(comparisonFor({ comparison: [entry({ asOf: '2026-01-01' })] }, snapshot)).toBeUndefined();
  });

  it('lista os registros do mais recente para o mais antigo, sem alterar o original', () => {
    const make = (asOf: string): Snapshot => ({ id: '11111111-1111-4111-8111-111111111111', asOf, portfolioCents: cents(1), note: null });
    const input = [make('2026-01-01'), make('2026-09-01'), make('2026-05-01')];
    expect(sortSnapshots(input).map((s) => s.asOf)).toEqual(['2026-09-01', '2026-05-01', '2026-01-01']);
    expect(input[0]?.asOf).toBe('2026-01-01');
  });
});

describe('formulário Registrar posição', () => {
  it('começa com a data de hoje e sem valor', () => {
    expect(emptySnapshotValues(TODAY)).toEqual({ asOf: TODAY, amount: '', note: '' });
  });

  it('converte texto em centavos (parseBRL) e observação vazia vira null', () => {
    expect(buildSnapshotBody({ asOf: '2026-09-30', amount: 'R$ 12.345,67', note: '  ' }, TODAY)).toEqual({
      ok: true,
      body: { asOf: '2026-09-30', portfolioCents: 1_234_567, note: null },
    });
    const withNote = buildSnapshotBody({ asOf: TODAY, amount: '0', note: ' fim do mês ' }, TODAY);
    expect(withNote).toEqual({ ok: true, body: { asOf: TODAY, portfolioCents: 0, note: 'fim do mês' } });
  });

  it('recusa data futura, data inexistente, valor vazio/negativo/lixo e observação longa, cada um no seu campo', () => {
    const result = buildSnapshotBody({ asOf: '2026-10-04', amount: '', note: 'x'.repeat(281) }, TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['amount', 'asOf', 'note']);
    for (const amount of ['-5', 'abc', '  ']) {
      const r = buildSnapshotBody({ asOf: TODAY, amount, note: '' }, TODAY);
      expect(r.ok, amount).toBe(false);
    }
    const bad = buildSnapshotBody({ asOf: '2026-02-31', amount: '1', note: '' }, TODAY);
    expect(bad.ok).toBe(false);
  });

  it('o resumo de erros diz o campo e a ordem de tela; o foco vai ao primeiro', () => {
    const result = buildSnapshotBody({ asOf: '2026-10-04', amount: '', note: '' }, TODAY);
    if (result.ok) throw new Error('esperava erro');
    expect(snapshotErrorSummary(result.errors)).toBe(
      'Confira os campos antes de registrar. Data: A data da posição não pode estar no futuro. · Total investido: Informe o total investido (zero ou mais).',
    );
    expect(firstSnapshotErrorId(result.errors)).toBe('position-date');
    expect(firstSnapshotErrorId({ amount: 'x' })).toBe('position-amount');
    expect(firstSnapshotErrorId({})).toBeNull();
  });

  it('editar carrega o registro no formulário e volta ao mesmo corpo', () => {
    const snapshot: Snapshot = { id: '11111111-1111-4111-8111-111111111111', asOf: '2026-09-30', portfolioCents: cents(1_234_567), note: 'fim do mês' };
    const values = snapshotToValues(snapshot);
    expect(values).toEqual({ asOf: '2026-09-30', amount: 'R$ 12.345,67', note: 'fim do mês' });
    expect(buildSnapshotBody(values, TODAY)).toEqual({
      ok: true,
      body: { asOf: '2026-09-30', portfolioCents: 1_234_567, note: 'fim do mês' },
    });
  });
});

describe('confirmações e avisos', () => {
  it('textos curtos por evento, e o evento certo depois de salvar', () => {
    expect(confirmationText('created')).toBe('Posição registrada.');
    expect(confirmationText('replaced')).toBe('Já havia um registro nesta data: ele foi atualizado.');
    expect(confirmationText('edited')).toBe('Registro atualizado.');
    expect(confirmationText('deleted')).toBe('Registro apagado.');
    expect(confirmationText('applied')).toBe('Patrimônio atual do plano atualizado.');
    expect(eventAfterSave({ editing: false, replaced: false })).toBe('created');
    expect(eventAfterSave({ editing: false, replaced: true })).toBe('replaced');
    expect(eventAfterSave({ editing: true, replaced: undefined })).toBe('edited');
    expect(eventAfterSave({ editing: false, replaced: undefined })).toBe('created');
  });

  const snapshot: Snapshot = { id: '11111111-1111-4111-8111-111111111111', asOf: '2026-09-30', portfolioCents: cents(1_200_000), note: null };

  it('a pergunta de "usar como patrimônio" diz que muda o ponto de partida das projeções', () => {
    const text = applyToPlanQuestion(snapshot);
    expect(text).toContain('R$ 12.000,00');
    expect(text).toContain('30/09/2026');
    expect(text).toContain('ponto de partida das projeções');
    expect(deleteQuestion(snapshot)).toBe('Apagar o registro de 30/09/2026 (R$ 12.000,00)?');
  });

  it('reconhece o registro que já é o ponto de partida do plano: pela DATA exata da âncora', () => {
    const plan = {
      plannedMonthlyCents: cents(1),
      currentPortfolioCents: cents(1_200_000),
      startCompetence: '2026-09',
      currentPortfolioAsOf: '2026-09-30',
    };
    expect(isCurrentPortfolio({ plan }, snapshot)).toBe(true);
    expect(isCurrentPortfolio({ plan: { ...plan, currentPortfolioAsOf: '2026-08-31' } }, snapshot)).toBe(false);
    expect(isCurrentPortfolio({ plan: null }, snapshot)).toBe(false);
  });

  it('dois registros no mesmo mês com o mesmo valor: só o da data exata é o atual', () => {
    const plan = {
      plannedMonthlyCents: cents(1),
      currentPortfolioCents: cents(1_200_000),
      startCompetence: '2026-09',
      currentPortfolioAsOf: '2026-09-30',
    };
    const make = (id: string, asOf: string): Snapshot => ({ id, asOf, portfolioCents: cents(1_200_000), note: null });
    const midMonth = make('22222222-2222-4222-8222-222222222222', '2026-09-15');
    const endOfMonth = make('11111111-1111-4111-8111-111111111111', '2026-09-30');
    expect(isCurrentPortfolio({ plan }, endOfMonth)).toBe(true);
    expect(isCurrentPortfolio({ plan }, midMonth)).toBe(false);
  });
});
