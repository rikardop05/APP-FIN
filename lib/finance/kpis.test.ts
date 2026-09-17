import { describe, expect, it } from 'vitest';

import {
  divergentStatements,
  monthlyKpis,
  spendingByCategory,
  type CategoryNature,
  type DivergentStatementInput,
  type MonthlyKpisInput,
  type SpendingByCategoryInput,
  type TransactionKind,
} from '@/lib/finance/kpis';
import { cents } from '@/lib/money';

type KpiTx = MonthlyKpisInput['transactions'][number];
type SpendTx = SpendingByCategoryInput['transactions'][number];
type SpendCategory = SpendingByCategoryInput['categories'][number];

function kpiTx(
  amountCents: number,
  kind: TransactionKind,
  categoryNature: CategoryNature,
  status: KpiTx['status'] = 'posted',
): KpiTx {
  return { amountCents: cents(amountCents), kind, categoryNature, status };
}

function spendTx(
  competence: string,
  amountCents: number,
  categoryId: string | null,
  kind: TransactionKind = 'expense',
): SpendTx {
  return { competence, amountCents: cents(amountCents), kind, categoryId };
}

function kpiInput(
  transactions: KpiTx[],
  overrides: Partial<MonthlyKpisInput> = {},
): MonthlyKpisInput {
  return {
    competence: '2026-09',
    transactions,
    futureInstallmentsCents: cents(0),
    uncategorizedCount: 0,
    ...overrides,
  };
}

describe('monthlyKpis', () => {
  it('soma os baldes por kind, corta em zero e ignora transferencia e fatura', () => {
    // Lancamentos de setembro/2026 (saida negativa, entrada positiva).
    const result = monthlyKpis(
      kpiInput(
        [
          // Receita: 500000 + 100000 = 600000.
          kpiTx(500000, 'income', 'income'),
          kpiTx(100000, 'income', 'income'),
          // Despesa: 80000 + 30000 + 150000 = 260000.
          kpiTx(-80000, 'expense', 'essential'),
          kpiTx(-30000, 'expense', 'non_essential'),
          kpiTx(-150000, 'expense', 'essential'),
          // Invisiveis (RC-03): nao entram em campo nenhum.
          kpiTx(-200000, 'transfer', 'non_essential'),
          kpiTx(-60000, 'credit_card_payment', 'non_essential'),
          // Aporte: bucket proprio (RC-04).
          kpiTx(-50000, 'investment_contribution', 'investment'),
        ],
        { futureInstallmentsCents: cents(123400), uncategorizedCount: 7 },
      ),
    );

    expect(result.incomeCents).toBe(600000);
    expect(result.expenseCents).toBe(260000);
    expect(result.contributionsCents).toBe(50000);
    // Sobra = 600000 - 260000 = 340000. Aporte NAO e subtraido.
    expect(result.surplusCents).toBe(340000);
    // Taxa de poupanca = 340000 / 600000 = 0,5666... -> 5667 bp.
    expect(result.savingsRateBp).toBe(5667);
    // Essenciais = 80000 + 150000 = 230000; 230000 / 600000 -> 3833 bp.
    expect(result.essentialShareBp).toBe(3833);
    expect(result.futureInstallmentsCents).toBe(123400);
    expect(result.uncategorizedCount).toBe(7);
  });

  it('mes sem nenhum lancamento zera os valores e devolve null nas taxas', () => {
    const result = monthlyKpis(kpiInput([]));
    expect(result.incomeCents).toBe(0);
    expect(result.expenseCents).toBe(0);
    expect(result.contributionsCents).toBe(0);
    expect(result.surplusCents).toBe(0);
    expect(result.savingsRateBp).toBeNull();
    expect(result.essentialShareBp).toBeNull();
  });

  it('mes so com transferencia tem despesa ZERO (RC-03)', () => {
    const result = monthlyKpis(
      kpiInput([
        kpiTx(-300000, 'transfer', 'non_essential'),
        kpiTx(300000, 'transfer', 'non_essential'),
      ]),
    );
    expect(result.expenseCents).toBe(0);
    expect(result.incomeCents).toBe(0);
    expect(result.contributionsCents).toBe(0);
    expect(result.surplusCents).toBe(0);
    expect(result.savingsRateBp).toBeNull();
  });

  it('mes so com pagamento de fatura tem despesa ZERO (RC-03)', () => {
    const result = monthlyKpis(
      kpiInput([kpiTx(-420000, 'credit_card_payment', 'non_essential')]),
    );
    expect(result.expenseCents).toBe(0);
    expect(result.contributionsCents).toBe(0);
    expect(result.savingsRateBp).toBeNull();
  });

  it('aporte aparece separado E nao reduz a sobra (RC-04)', () => {
    // Renda 100000 e aporte 50000: despesa 0, sobra 100000 (nao 50000).
    const result = monthlyKpis(
      kpiInput([
        kpiTx(100000, 'income', 'income'),
        kpiTx(-50000, 'investment_contribution', 'investment'),
      ]),
    );
    expect(result.expenseCents).toBe(0);
    expect(result.contributionsCents).toBe(50000);
    expect(result.surplusCents).toBe(100000);
    expect(result.savingsRateBp).toBe(10000);
  });

  it('deficit devolve sobra negativa e taxa de poupanca negativa', () => {
    // 100000 - 250000 = -150000; /100000 = -15000 bp.
    const result = monthlyKpis(
      kpiInput([
        kpiTx(100000, 'income', 'income'),
        kpiTx(-250000, 'expense', 'essential'),
      ]),
    );
    expect(result.surplusCents).toBe(-150000);
    expect(result.savingsRateBp).toBe(-15000);
  });

  it('mes so com estorno de despesa tem despesa ZERO', () => {
    // Estorno: kind 'expense' com valor POSITIVO (dinheiro voltando).
    // max(0, -(+5000)) = 0, nao 5000.
    const result = monthlyKpis(kpiInput([kpiTx(5000, 'expense', 'essential')]));
    expect(result.expenseCents).toBe(0);
    expect(result.essentialShareBp).toBeNull();
  });

  it('mes so com estorno de receita tem receita ZERO', () => {
    // Estorno de receita: kind 'income' com valor NEGATIVO.
    // max(0, -5000) = 0, nao 5000.
    const result = monthlyKpis(kpiInput([kpiTx(-5000, 'income', 'income')]));
    expect(result.incomeCents).toBe(0);
    expect(result.savingsRateBp).toBeNull();
  });

  it('mes so com resgate de investimento tem aporte ZERO', () => {
    // Resgate: kind 'investment_contribution' com valor POSITIVO.
    // max(0, -(+5000)) = 0, nao 5000.
    const result = monthlyKpis(
      kpiInput([kpiTx(5000, 'investment_contribution', 'investment')]),
    );
    expect(result.contributionsCents).toBe(0);
  });

  it('compra com estorno no mesmo mes: despesa e o liquido (10000 - 4000)', () => {
    // Compra -10000 e estorno +4000, os dois kind 'expense'.
    // liquido = -6000; max(0, -(-6000)) = 6000.
    const result = monthlyKpis(
      kpiInput([
        kpiTx(-10000, 'expense', 'non_essential'),
        kpiTx(4000, 'expense', 'non_essential'),
      ]),
    );
    expect(result.expenseCents).toBe(6000);
  });

  it('estorno maior que a compra e cortado pelo piso (limitacao conhecida)', () => {
    // Compra -10000 e estorno +14000: liquido +4000, sobra do estorno cortada.
    // max(0, -(+4000)) = 0; nao vira receita nem despesa.
    const result = monthlyKpis(
      kpiInput([
        kpiTx(-10000, 'expense', 'non_essential'),
        kpiTx(14000, 'expense', 'non_essential'),
      ]),
    );
    expect(result.expenseCents).toBe(0);
    expect(result.incomeCents).toBe(0);
  });

  it('essentialShareBp e sobre a RENDA, nao sobre a despesa', () => {
    // Essencial 20000, nao-essencial 30000 -> despesa 50000.
    // Sobre a renda: 20000 / 100000 = 2000 bp (e nao 20000/50000 = 4000).
    const result = monthlyKpis(
      kpiInput([
        kpiTx(100000, 'income', 'income'),
        kpiTx(-20000, 'expense', 'essential'),
        kpiTx(-30000, 'expense', 'non_essential'),
      ]),
    );
    expect(result.expenseCents).toBe(50000);
    expect(result.essentialShareBp).toBe(2000);
    expect(result.savingsRateBp).toBe(5000);
  });

  it('posted e planned somam os dois', () => {
    const result = monthlyKpis(
      kpiInput([
        kpiTx(-10000, 'expense', 'essential', 'posted'),
        kpiTx(-10000, 'expense', 'essential', 'planned'),
      ]),
    );
    expect(result.expenseCents).toBe(20000);
  });

  it('razao patologica satura em vez de lancar', () => {
    // Renda de 1 centavo contra despesa essencial de R$ 10 trilhoes:
    // 1e15 / 1 * 10000 estoura o safe integer. Satura, nunca lanca.
    const result = monthlyKpis(
      kpiInput([
        kpiTx(1, 'income', 'income'),
        kpiTx(-1000000000000000, 'expense', 'essential'),
      ]),
    );
    expect(result.essentialShareBp).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.savingsRateBp).toBe(-Number.MAX_SAFE_INTEGER);
  });

  it('recusa competencia malformada', () => {
    expect(() =>
      monthlyKpis(kpiInput([], { competence: '2026-9' })),
    ).toThrow(RangeError);
  });
});

describe('spendingByCategory', () => {
  const CATEGORIES: SpendCategory[] = [
    { id: 'mercado', name: 'Mercado', nature: 'essential' },
    { id: 'restaurantes', name: 'Restaurantes', nature: 'non_essential' },
    { id: 'assinaturas', name: 'Assinaturas', nature: 'non_essential' },
    { id: 'transporte', name: 'Transporte', nature: 'non_essential' },
    { id: 'lazer', name: 'Lazer', nature: 'non_essential' },
  ];

  it('agrega o mes e a media dos 3 meses anteriores, numa passada', () => {
    const result = spendingByCategory({
      competence: '2026-06',
      categories: CATEGORIES,
      transactions: [
        // Mercado: abr 90000, mai 60000, jun 30000.
        spendTx('2026-04', -90000, 'mercado'),
        spendTx('2026-05', -60000, 'mercado'),
        spendTx('2026-06', -30000, 'mercado'),
        // Restaurantes: so junho -> media zero.
        spendTx('2026-06', -45000, 'restaurantes'),
        // Assinaturas: so marco (3 meses atras) -> sumiu no mes.
        spendTx('2026-03', -3000, 'assinaturas'),
        // Transporte: 100 + 100 nos dois meses anteriores -> media 200/3 = 67.
        spendTx('2026-04', -100, 'transporte'),
        spendTx('2026-05', -100, 'transporte'),
        // Ruido que NAO pode entrar:
        spendTx('2026-06', -500, 'mercado', 'transfer'),
        spendTx('2026-06', 999, 'mercado', 'income'),
        spendTx('2026-06', -100, null),
        spendTx('2026-02', -700, 'mercado'),
        spendTx('2026-06', -1234, 'fantasma'),
      ],
    });

    // Mercado: media (90000 + 60000 + 0) / 3 = 50000.
    // Variacao = (30000 - 50000) / 50000 = -0,4 -> -4000 bp.
    // Restaurantes: media 0 -> variacao null.
    // Assinaturas: spent 0, media (0 + 0 + 3000) / 3 = 1000,
    //   variacao = (0 - 1000) / 1000 = -10000 bp.
    // Transporte: spent 0, media (0 + 100 + 100) / 3 = 66,67 -> 67,
    //   variacao = (0 - 67) / 67 = -10000 bp.
    // Lazer nunca teve gasto -> fora da lista.
    expect(result).toEqual([
      {
        categoryId: 'mercado',
        name: 'Mercado',
        nature: 'essential',
        spentCents: 30000,
        average3mCents: 50000,
        variationBp: -4000,
      },
      {
        categoryId: 'restaurantes',
        name: 'Restaurantes',
        nature: 'non_essential',
        spentCents: 45000,
        average3mCents: 0,
        variationBp: null,
      },
      {
        categoryId: 'assinaturas',
        name: 'Assinaturas',
        nature: 'non_essential',
        spentCents: 0,
        average3mCents: 1000,
        variationBp: -10000,
      },
      {
        categoryId: 'transporte',
        name: 'Transporte',
        nature: 'non_essential',
        spentCents: 0,
        average3mCents: 67,
        variationBp: -10000,
      },
    ]);
  });

  it('variacao positiva quando o mes gasta acima da media', () => {
    // Media (0 + 30000 + 30000) / 3 = 20000; mes 90000.
    // (90000 - 20000) / 20000 = 3,5 -> 35000 bp.
    const result = spendingByCategory({
      competence: '2026-06',
      categories: [{ id: 'x', name: 'X', nature: 'non_essential' }],
      transactions: [
        spendTx('2026-04', -30000, 'x'),
        spendTx('2026-05', -30000, 'x'),
        spendTx('2026-06', -90000, 'x'),
      ],
    });

    expect(result[0]?.spentCents).toBe(90000);
    expect(result[0]?.average3mCents).toBe(20000);
    expect(result[0]?.variationBp).toBe(35000);
  });

  it('categoria zerada nos quatro meses fica fora (mesmo constando em categories)', () => {
    const result = spendingByCategory({
      competence: '2026-06',
      categories: CATEGORIES,
      transactions: [spendTx('2026-06', -1000, 'mercado')],
    });
    expect(result.map((entry) => entry.categoryId)).toEqual(['mercado']);
  });

  it('mes so com estorno na categoria da spentCents ZERO, nao valor positivo', () => {
    // Mercado: compra em abr (-30000) e SO estorno em jun (+5000).
    // Jun = max(0, -(+5000)) = 0; media = (0 + 30000 + 0) / 3 = 10000;
    // variacao = (0 - 10000) / 10000 = -10000 bp.
    // Lazer: so estorno em jun, sem gasto nos quatro meses -> fora da lista.
    const result = spendingByCategory({
      competence: '2026-06',
      categories: CATEGORIES,
      transactions: [
        spendTx('2026-04', -30000, 'mercado'),
        spendTx('2026-06', 5000, 'mercado'),
        spendTx('2026-06', 7000, 'lazer'),
      ],
    });

    expect(result).toEqual([
      {
        categoryId: 'mercado',
        name: 'Mercado',
        nature: 'essential',
        spentCents: 0,
        average3mCents: 10000,
        variationBp: -10000,
      },
    ]);
  });

  it('sem transacoes devolve lista vazia, nunca NaN', () => {
    const result = spendingByCategory({
      competence: '2026-06',
      categories: CATEGORIES,
      transactions: [],
    });
    expect(result).toEqual([]);
  });

  it('mes recortado fora da janela nao conta (limite exato de 3 meses)', () => {
    // 2026-02 e quatro meses antes de 2026-06 -> fora. 2026-03 entra.
    const result = spendingByCategory({
      competence: '2026-06',
      categories: [{ id: 'x', name: 'X', nature: 'non_essential' }],
      transactions: [
        spendTx('2026-02', -50000, 'x'),
        spendTx('2026-03', -3000, 'x'),
      ],
    });
    expect(result).toEqual([
      {
        categoryId: 'x',
        name: 'X',
        nature: 'non_essential',
        spentCents: 0,
        average3mCents: 1000,
        variationBp: -10000,
      },
    ]);
  });
});

describe('divergentStatements', () => {
  function statement(
    statementId: string,
    reportedTotalCents: number | null,
    amounts: number[],
  ): DivergentStatementInput {
    return {
      statementId,
      reportedTotalCents:
        reportedTotalCents === null ? null : cents(reportedTotalCents),
      transactions: amounts.map((amountCents) => ({
        amountCents: cents(amountCents),
      })),
    };
  }

  it('reporta so fatura com total informado E diferenca diferente de zero', () => {
    const result = divergentStatements([
      // Bate: computed -10000, reported -10000 -> diferenca 0.
      statement('a', -10000, [-6000, -4000]),
      // Falta lancamento: computed -10000, reported -8000 -> -2000.
      statement('b', -8000, [-6000, -4000]),
      // Sem total informado: nada a conferir.
      statement('c', null, [-1000]),
      // Lancamos mais: computed -10000, reported -3000 -> -7000.
      statement('d', -3000, [-6000, -4000]),
      // Fatia vazia com total informado: 0 - (-5000) = +5000.
      statement('e', -5000, []),
    ]);

    expect(result).toEqual([
      { statementId: 'b', differenceCents: -2000 },
      { statementId: 'd', differenceCents: -7000 },
      { statementId: 'e', differenceCents: 5000 },
    ]);
  });

  it('sem faturas devolve lista vazia', () => {
    expect(divergentStatements([])).toEqual([]);
  });
});
