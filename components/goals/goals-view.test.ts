import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';

import { deadlineSummary } from './describe';
import { goalFormToBody, initialGoalValues, type GoalFormValues } from './form-body';
import type { GoalView } from './schemas';

function view(progress: GoalView['progress']): Pick<GoalView, 'progress' | 'targetCents'> {
  return { progress, targetCents: progress === null ? null : cents(1) };
}

describe('deadlineSummary: a ausência aparece como ausência', () => {
  it('sem alvo (reserva sem histórico): no-target', () => {
    expect(deadlineSummary(view(null))).toEqual({ kind: 'no-target' });
  });

  it('alvo 0 (reserva com histórico mas sem despesa essencial): zero-target, outra mensagem', () => {
    expect(deadlineSummary({ progress: null, targetCents: cents(0) })).toEqual({ kind: 'zero-target' });
  });

  it('sem data: no-deadline, nunca um aporte de R$ 0,00', () => {
    expect(
      deadlineSummary(
        view({ progressBp: 2500, remainingCents: cents(750_000), monthsRemaining: null, requiredMonthlyCents: null, onTrack: null }),
      ),
    ).toEqual({ kind: 'no-deadline' });
  });

  it('com data: o aporte mensal e os meses', () => {
    expect(
      deadlineSummary(
        view({ progressBp: 2500, remainingCents: cents(750_000), monthsRemaining: 5, requiredMonthlyCents: cents(150_000), onTrack: true }),
      ),
    ).toEqual({ kind: 'monthly', requiredMonthlyCents: 150_000, months: 5 });
  });

  it('nada falta: done (mesmo com data)', () => {
    expect(
      deadlineSummary(
        view({ progressBp: 10_000, remainingCents: cents(0), monthsRemaining: 5, requiredMonthlyCents: cents(0), onTrack: true }),
      ),
    ).toEqual({ kind: 'done' });
  });

  it('prazo neste mês e vencido são situações diferentes', () => {
    const base = { progressBp: 4000, remainingCents: cents(60_000), monthsRemaining: 0, requiredMonthlyCents: cents(60_000) };
    expect(deadlineSummary(view({ ...base, onTrack: true }))).toEqual({ kind: 'due-now', remainingCents: 60_000 });
    expect(deadlineSummary(view({ ...base, onTrack: false }))).toEqual({ kind: 'overdue', remainingCents: 60_000 });
  });
});

const valid: GoalFormValues = {
  name: '  Viagem  ',
  target: 'R$ 10.000,00',
  targetDate: '2027-03-15',
  current: 'R$ 2.500,00',
  accountId: '',
  priority: '50',
  status: 'active',
  isEmergencyFund: false,
};

describe('goalFormToBody', () => {
  it('converte texto em centavos (parseBRL), apara o nome e mantém o prazo', () => {
    expect(goalFormToBody(valid)).toEqual({
      ok: true,
      body: {
        name: 'Viagem',
        targetCents: 1_000_000,
        targetDate: '2027-03-15',
        currentCents: 250_000,
        accountId: null,
        priority: 50,
        status: 'active',
        isEmergencyFund: false,
      },
    });
  });

  it('sem data: targetDate é null (não string vazia)', () => {
    const result = goalFormToBody({ ...valid, targetDate: '' });
    expect(result.ok && result.body.targetDate).toBeNull();
  });

  it('com conta vinculada o valor atual digitado é ignorado (vale o saldo)', () => {
    const result = goalFormToBody({ ...valid, current: 'lixo', accountId: '11111111-1111-4111-8111-111111111111' });
    expect(result.ok && result.body.currentCents).toBe(0);
    expect(result.ok && result.body.accountId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('reserva de emergência: não exige alvo e manda targetCents null', () => {
    const result = goalFormToBody({ ...valid, isEmergencyFund: true, target: '' });
    expect(result.ok && result.body.targetCents).toBeNull();
  });

  it('recusa alvo zero, vazio, atual negativo, prioridade fora da faixa e nome vazio', () => {
    const bad = goalFormToBody({ ...valid, name: ' ', target: 'R$ 0,00', current: '-5', priority: '0' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(Object.keys(bad.errors).sort()).toEqual(['current', 'name', 'priority', 'target']);
    }
    expect(goalFormToBody({ ...valid, target: '' }).ok).toBe(false);
  });
});

describe('initialGoalValues', () => {
  it('meta nova da reserva já vem marcada, com nome e prioridade 1', () => {
    expect(initialGoalValues(undefined, true)).toMatchObject({
      name: 'Reserva de emergência',
      isEmergencyFund: true,
      priority: '1',
    });
  });

  it('meta nova comum: prioridade padrão 100 e sem alvo preenchido', () => {
    expect(initialGoalValues(undefined)).toMatchObject({ priority: '100', target: '', isEmergencyFund: false });
  });
});
