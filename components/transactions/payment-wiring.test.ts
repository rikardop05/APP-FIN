import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('situacao de pagamento: ligacao entre query, rota e telas', () => {
  it('a rota de lancamentos devolve o resumo de pago e pendente', () => {
    expect(read('app/api/transactions/route.ts')).toContain('listTransactionsWithSettlement');
    expect(read('app/api/transactions/route.ts')).toContain('settlement');
  });
  it('a lista usa o selo da situacao (texto + letra) e o resumo do mes, sem somar nada', () => {
    const list = read('components/transactions/transaction-list.tsx');
    expect(list).toContain('paymentSituation(row, today)');
    expect(list).toContain('Pago <Money');
    expect(list).toContain('Pendente <Money');
    expect(list).not.toMatch(/paidCents\s*[-+]\s|pendingCents\s*[-+]\s/);
  });
  it('o filtro Situacao e so da tela e entra na contagem de filtros', () => {
    expect(read('components/transactions/lancamentos-screen.tsx')).toContain('matchesSettlement(row, filters.settlement)');
    expect(read('components/transactions/transaction-filters.tsx')).toContain('Situação');
  });
  it('trocar a Situacao nao refaz o fetch e poda a selecao contra as linhas visiveis', () => {
    const screen = read('components/transactions/lancamentos-screen.tsx');
    expect(screen).toContain('queryString(current) === queryString(filters)');
    expect(screen).toContain('pruneSelection(previous, rows)');
  });
  it('o resumo do mes diz que e de todas as faturas', () => {
    expect(read('components/transactions/transaction-list.tsx')).toContain('Todas as faturas de');
    expect(read('components/dashboard/committed-card.tsx')).toContain('Todas as faturas de');
  });
  it('o Painel e Cartoes leem pago e pendente da mesma fonte (settleStatement)', () => {
    expect(read('lib/db/queries/cards.ts')).toContain('settleStatement');
    expect(read('lib/db/queries/card-settlement.ts')).toContain('settleStatement');
    expect(read('app/(app)/page.tsx')).toContain('settlementByCompetence');
    expect(read('components/dashboard/committed-card.tsx')).toContain('currentSettlement');
  });
});
