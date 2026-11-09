import { describe, expect, it } from 'vitest';
import { matchesSettlement, paymentSituation, pruneSelection, type PaymentRowLike } from './payment-situation';

const base: PaymentRowLike = {
  creditCardId: 'card',
  competence: '2026-10',
  status: 'posted',
  statementStatus: 'open',
  statementDueDate: '2026-11-10',
  statementPayment: 'none',
};
const TODAY = '2026-11-09';

describe('paymentSituation: selo da fatura na linha de cartao', () => {
  it('conta nao tem selo', () => {
    expect(paymentSituation({ ...base, creditCardId: null, statementStatus: null }, TODAY)).toBeNull();
  });
  it('paga, paga em parte, em aberto e vencida', () => {
    expect(paymentSituation({ ...base, statementStatus: 'paid', statementPayment: 'full' }, TODAY)?.label).toBe('Fatura paga');
    expect(paymentSituation({ ...base, statementStatus: 'paid', statementPayment: 'over' }, TODAY)?.label).toBe('Fatura paga');
    expect(paymentSituation({ ...base, statementStatus: 'paid', statementPayment: 'partial' }, TODAY)?.label).toBe('Fatura paga em parte');
    expect(paymentSituation(base, TODAY)?.label).toBe('Fatura em aberto');
    expect(paymentSituation({ ...base, statementDueDate: '2026-11-05' }, TODAY)).toMatchObject({ label: 'Fatura vencida', tone: 'danger' });
    expect(paymentSituation({ ...base, statementDueDate: TODAY }, TODAY)?.label).toBe('Fatura em aberto');
  });
  it('parcela futura sem fatura: a vencer em <mes>; passada sem fatura: nada', () => {
    const futura: PaymentRowLike = { ...base, statementStatus: null, statementDueDate: null, statementPayment: null, competence: '2027-01', status: 'planned' };
    expect(paymentSituation(futura, TODAY)?.label).toBe('A vencer em jan/2027');
    expect(paymentSituation({ ...futura, competence: '2026-08' }, TODAY)).toBeNull();
  });
  it('todo selo tem texto por extenso e letra', () => {
    for (const row of [base, { ...base, statementStatus: 'paid' as const, statementPayment: 'full' as const }]) {
      const s = paymentSituation(row, TODAY);
      expect(s?.label.length).toBeGreaterThan(3);
      expect(s?.letter).toMatch(/^[A-Z]$/);
    }
  });
});

describe('compra de cartao de mes passado sem fatura', () => {
  const passada: PaymentRowLike = { creditCardId: 'card', competence: '2026-08', status: 'posted', statementStatus: null, statementDueDate: null, statementPayment: null };
  it('ganha o selo Sem fatura importada e continua em Pendentes', () => {
    expect(paymentSituation(passada, TODAY)).toMatchObject({ label: 'Sem fatura importada', tone: 'attention' });
    expect(matchesSettlement(passada, 'pending')).toBe(true);
    expect(matchesSettlement(passada, 'paid')).toBe(false);
  });
  it('previsto passado sem fatura continua sem selo', () => {
    expect(paymentSituation({ ...passada, status: 'planned' }, TODAY)).toBeNull();
  });
});

describe('pruneSelection: lote so em linha visivel', () => {
  it('tira os ids escondidos e mantem os visiveis', () => {
    expect(pruneSelection(['a', 'b', 'c'], [{ id: 'b' }, { id: 'z' }])).toEqual(['b']);
  });
  it('sem nada escondido devolve a mesma selecao; vazia fica vazia', () => {
    expect(pruneSelection(['a', 'b'], [{ id: 'a' }, { id: 'b' }])).toEqual(['a', 'b']);
    expect(pruneSelection([], [{ id: 'a' }])).toEqual([]);
  });
  it('filtro Situacao esconde a linha: ela sai da selecao', () => {
    const paga: PaymentRowLike & { id: string } = { id: 'p', creditCardId: 'c', competence: '2026-10', status: 'posted', statementStatus: 'paid', statementDueDate: '2026-10-10', statementPayment: 'full' };
    const aberta: PaymentRowLike & { id: string } = { ...paga, id: 'o', statementStatus: 'open', statementPayment: 'none' };
    const visiveis = [paga, aberta].filter((row) => matchesSettlement(row, 'pending'));
    expect(pruneSelection(['p', 'o'], visiveis)).toEqual(['o']);
  });
});

describe('matchesSettlement: filtro Situacao', () => {
  const paga: PaymentRowLike = { ...base, statementStatus: 'paid', statementPayment: 'full' };
  const parcial: PaymentRowLike = { ...base, statementStatus: 'paid', statementPayment: 'partial' };
  const conta: PaymentRowLike = { ...base, creditCardId: null, statementStatus: null, statementDueDate: null, statementPayment: null };
  it('vazio deixa tudo passar', () => {
    for (const row of [paga, parcial, base, conta]) expect(matchesSettlement(row, '')).toBe(true);
  });
  it('pagos: conta lancada e cartao com fatura paga inteira', () => {
    expect(matchesSettlement(paga, 'paid')).toBe(true);
    expect(matchesSettlement(conta, 'paid')).toBe(true);
    expect(matchesSettlement(parcial, 'paid')).toBe(false);
    expect(matchesSettlement(base, 'paid')).toBe(false);
  });
  it('pendentes: aberta, vencida, parcial, previsto e parcela sem fatura', () => {
    expect(matchesSettlement(base, 'pending')).toBe(true);
    expect(matchesSettlement(parcial, 'pending')).toBe(true);
    expect(matchesSettlement({ ...conta, status: 'planned' }, 'pending')).toBe(true);
    expect(matchesSettlement({ ...base, statementStatus: null, statementPayment: null }, 'pending')).toBe(true);
    expect(matchesSettlement(paga, 'pending')).toBe(false);
  });
});

describe('estado vazio com o filtro Situacao', () => {
  it('Pagos sem resultado conta como filtro ativo (Limpar filtros, nao "Nenhum lancamento ainda")', async () => {
    const { EMPTY_FILTERS, hasActiveFilters } = await import('./filter-presentation');
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, settlement: 'paid' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, settlement: 'pending' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, uncategorized: true })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, search: '  ' })).toBe(false);
  });
  it('a tela decide o vazio pelos filtros atuais (nao pelos aplicados, que ignoram a Situacao)', async () => {
    const { readFileSync } = await import('node:fs');
    const screen = readFileSync('components/transactions/lancamentos-screen.tsx', 'utf8');
    expect(screen).toContain('hasActiveFilters(filters)');
    expect(screen).not.toContain('hasFilters(appliedFilters)');
  });
});
