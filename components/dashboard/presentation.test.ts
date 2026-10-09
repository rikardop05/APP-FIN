import { describe, expect, it } from 'vitest';
import type { BasisPoints, Cents } from '@/lib/money';
import {
  commitmentEndLine,
  commitmentRows,
  commitmentTotal,
  contributionsTitle,
  monthName,
  nextMonthCommitment,
  pendingSummary,
  pendingTitle,
  stubMonths,
  surplusLabel,
  variationView,
  verdictLine,
} from './presentation';

const c = (n: number) => n as Cents;

describe('rotulos do topo', () => {
  it('nomeia mes e sobra ou deficit', () => {
    expect(monthName('2026-10')).toBe('outubro');
    expect(surplusLabel('2026-10', 100)).toBe('Sobra de outubro');
    expect(surplusLabel('2026-10', -1)).toBe('Déficit de outubro');
    expect(contributionsTitle('2026-03')).toBe('Aportes de março');
  });
  it('veredito: negativo, ok com ressalva, vazio e indisponivel', () => {
    expect(verdictLine({ kind: 'ok', firstNegativeCompetence: '2027-02', monthsCount: 12 })).toEqual({
      tone: 'danger',
      text: 'O saldo fica negativo em fevereiro de 2027.',
    });
    const ok = verdictLine({ kind: 'ok', firstNegativeCompetence: null, monthsCount: 12 });
    expect(ok.tone).toBe('ok');
    expect(ok.text).toContain('com o que está cadastrado');
    expect(verdictLine({ kind: 'empty' }).tone).toBe('neutral');
    expect(verdictLine({ kind: 'unavailable' }).text).toContain('Não foi possível');
  });
});

describe('comprometimento', () => {
  it('mes que vem e a magnitude do segundo mes devedor', () => {
    expect(
      nextMonthCommitment([
        { competence: '2026-10', totalCents: c(-100) },
        { competence: '2026-11', totalCents: c(-250) },
      ]),
    ).toEqual({ competence: '2026-11', cents: 250 });
    expect(
      nextMonthCommitment([
        { competence: '2026-10', totalCents: c(-100) },
        { competence: '2026-11', totalCents: c(0) },
      ]),
    ).toBeNull();
    expect(nextMonthCommitment([])).toBeNull();
  });
  it('as linhas fecham exatamente com o total, inclusive com estorno', () => {
    const breakdown = {
      overdueUnpaidCents: c(0), currentStatementCents: c(-76609),
      laterInstallmentsCents: c(-236615),
      laterPurchasesCents: c(1500),
    };
    const rows = commitmentRows(breakdown, '2026-10');
    expect(rows.map((r) => r.key)).toEqual(['current', 'installments', 'purchases']);
    const total = commitmentTotal(c(-76609 - 236615 + 1500));
    expect(rows.reduce((sum, r) => sum + r.valueCents, 0)).toBe(total);
  });
  it('faturas anteriores nao pagas entram na soma exata quando existem', () => {
    const breakdown = {
      overdueUnpaidCents: c(-107482),
      currentStatementCents: c(-76609),
      laterInstallmentsCents: c(-236615),
      laterPurchasesCents: c(0),
    };
    const rows = commitmentRows(breakdown, '2026-10');
    expect(rows.map((r) => r.key)).toEqual(['overdue', 'current', 'installments']);
    expect(rows.reduce((sum, r) => sum + r.valueCents, 0)).toBe(commitmentTotal(c(-107482 - 76609 - 236615)));
  });
  it('compras ja lancadas somem quando zero', () => {
    const rows = commitmentRows(
      { overdueUnpaidCents: c(0), currentStatementCents: c(-100), laterInstallmentsCents: c(-200), laterPurchasesCents: c(0) },
      '2026-10',
    );
    expect(rows.map((r) => r.key)).toEqual(['current', 'installments']);
    expect(rows[0]?.label).toBe('Faturas de out/2026');
  });
  it('linha final e canhotos presos', () => {
    expect(commitmentEndLine(null, '2028-09')).toBeNull();
    expect(commitmentEndLine('2027-03', '2028-09')).toBe('Termina de pagar em mar/2027.');
    expect(commitmentEndLine('2028-09', '2028-09')).toContain('Comprometido até set/2028');
    const entries = [
      { competence: '2026-10', totalCents: c(-1) },
      { competence: '2026-11', totalCents: c(-2) },
      { competence: '2026-12', totalCents: c(0) },
      { competence: '2027-01', totalCents: c(-3) },
      { competence: '2027-02', totalCents: c(-4) },
    ];
    const { shown, hiddenCount } = stubMonths(entries, 2);
    expect(shown.map((e) => e.competence)).toEqual(['2026-11', '2027-01']);
    expect(hiddenCount).toBe(1);
  });
});

describe('pendencias', () => {
  it('conta e descreve', () => {
    const s = pendingSummary({ uncategorizedCount: 2, divergentCount: 1, overBudgetCount: 0, overdueRecurringCount: 0 });
    expect(s.total).toBe(3);
    expect(s.parts).toEqual(['2 sem categoria', '1 fatura divergente']);
    expect(pendingTitle(0)).toBe('Nada pendente');
    expect(pendingTitle(1)).toBe('1 pendência');
    expect(pendingTitle(3)).toBe('3 pendências');
  });
});

describe('variationView', () => {
  const bp = (n: number) => n as BasisPoints;
  it('categoria sem gasto no mes nao mostra -100% verde', () => {
    expect(variationView({ spentCents: c(0), average3mCents: c(5000), variationBp: bp(-10000) })).toEqual({
      text: 'sem gasto no mês',
      tone: 'muted',
    });
  });
  it('sem media', () => {
    expect(variationView({ spentCents: c(100), average3mCents: c(0), variationBp: null }).text).toBe('sem média');
  });
  it('mais que a media e atencao, menos e ok', () => {
    expect(variationView({ spentCents: c(150), average3mCents: c(100), variationBp: bp(5000) })).toEqual({
      text: '+50,00%',
      tone: 'attention',
    });
    expect(variationView({ spentCents: c(50), average3mCents: c(100), variationBp: bp(-5000) })).toEqual({
      text: '−50,00%',
      tone: 'ok',
    });
  });
});
