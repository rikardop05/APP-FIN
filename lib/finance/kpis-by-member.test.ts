import { describe, expect, it } from 'vitest';

import { monthlyKpis, spendingByMember, type TransactionKind } from '@/lib/finance/kpis';
import { cents } from '@/lib/money';

const ana = { id: 'ana', name: 'Ana' };
const beto = { id: 'beto', name: 'Beto' };
const members = [ana, beto];

function tx(amount: number, kind: TransactionKind, memberId: string | null) {
  return { amountCents: cents(amount), kind, memberId };
}

describe('spendingByMember', () => {
  it('soma a despesa por responsável, maior primeiro, "Sem responsável" por último', () => {
    // Ana: 100,00 + 50,25 = 150,25 | Beto: 300,00 | sem responsável: 20,00
    const result = spendingByMember({
      members,
      transactions: [
        tx(-10000, 'expense', 'ana'),
        tx(-5025, 'expense', 'ana'),
        tx(-30000, 'expense', 'beto'),
        tx(-2000, 'expense', null),
      ],
    });
    expect(result.rows.map((r) => [r.name, r.spentCents])).toEqual([
      ['Beto', 30000],
      ['Ana', 15025],
      ['Sem responsável', 2000],
    ]);
    expect(result.totalCents).toBe(47025);
    expect(result.hasMember).toBe(true);
  });

  it('transferência, pagamento de fatura, aporte e receita ficam fora, como em monthlyKpis', () => {
    const result = spendingByMember({
      members,
      transactions: [
        tx(-10000, 'expense', 'ana'),
        tx(-99900, 'transfer', 'ana'),
        tx(-88800, 'credit_card_payment', 'beto'),
        tx(-77700, 'investment_contribution', 'beto'),
        tx(500000, 'income', 'ana'),
      ],
    });
    expect(result.rows).toEqual([{ memberId: 'ana', name: 'Ana', spentCents: 10000 }]);
    expect(result.totalCents).toBe(10000);
  });

  it('a soma das partes fecha com a Despesa do mês de monthlyKpis', () => {
    const lines = [
      tx(-12345, 'expense', 'ana'),
      tx(-6789, 'expense', 'beto'),
      tx(-1, 'expense', null),
      tx(3000, 'expense', 'ana'), // estorno de Ana
      tx(-5000, 'transfer', null),
    ];
    const result = spendingByMember({ members, transactions: lines });
    const kpis = monthlyKpis({
      competence: '2026-11',
      transactions: lines.map((l) => ({
        amountCents: l.amountCents,
        kind: l.kind,
        status: 'posted' as const,
        categoryNature: 'non_essential' as const,
      })),
      futureInstallmentsCents: cents(0),
      uncategorizedCount: 0,
    });
    expect(result.totalCents).toBe(kpis.expenseCents);
    expect(result.rows.reduce((sum, r) => sum + r.spentCents, 0)).toBe(kpis.expenseCents);
    // Ana: 123,45 - 30,00 = 93,45
    expect(result.rows.find((r) => r.memberId === 'ana')?.spentCents).toBe(9345);
  });

  it('grupo só com estorno sai da lista e a diferença é abatida do maior, fechando com o total', () => {
    // Beto: +40,00 (só estorno). Ana: 100,00. Total líquido: 60,00.
    const result = spendingByMember({
      members,
      transactions: [tx(-10000, 'expense', 'ana'), tx(4000, 'expense', 'beto')],
    });
    expect(result.totalCents).toBe(6000);
    expect(result.rows).toEqual([{ memberId: 'ana', name: 'Ana', spentCents: 6000 }]);
  });

  it('estorno grande de quem não gastou é abatido do maior para o menor, sem gasto negativo', () => {
    // Ana 100,00, Beto 80,00, sem responsável 50,00; Carla só estorno de 200,00. Total: 230 - 200 = 30,00.
    const carla = { id: 'carla', name: 'Carla' };
    const result = spendingByMember({
      members: [ana, beto, carla],
      transactions: [
        tx(-10000, 'expense', 'ana'),
        tx(-8000, 'expense', 'beto'),
        tx(-5000, 'expense', null),
        tx(20000, 'expense', 'carla'),
      ],
    });
    expect(result.totalCents).toBe(3000);
    // Ana: 100,00 - 100,00 = 0 (sai); Beto: 80,00 - 80,00 = 0 (sai); resta 20,00 a abater de Sem responsável: 50,00 - 20,00 = 30,00.
    expect(result.rows).toEqual([{ memberId: null, name: 'Sem responsável', spentCents: 3000 }]);
    expect(result.rows.every((r) => r.spentCents > 0)).toBe(true);
    expect(result.rows.reduce((sum, r) => sum + r.spentCents, 0)).toBe(result.totalCents);
  });

  it('só estorno no mês: nenhum grupo', () => {
    const result = spendingByMember({ members, transactions: [tx(5000, 'expense', 'ana')] });
    expect(result.rows).toEqual([]);
    expect(result.totalCents).toBe(0);
  });

  it('hasMember só é verdadeiro com despesa de alguém; responsável desconhecido cai em "Sem responsável"', () => {
    expect(spendingByMember({ members, transactions: [tx(-100, 'expense', null)] }).hasMember).toBe(false);
    expect(spendingByMember({ members, transactions: [tx(500000, 'income', 'ana')] }).hasMember).toBe(false);
    const unknown = spendingByMember({ members, transactions: [tx(-100, 'expense', 'fantasma')] });
    expect(unknown.hasMember).toBe(false);
    expect(unknown.rows).toEqual([{ memberId: null, name: 'Sem responsável', spentCents: 100 }]);
  });
});
