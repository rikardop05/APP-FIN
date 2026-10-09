import { describe, expect, it } from 'vitest';

import type { Competence } from '@/lib/date';
import type { CardCycleConfig } from '@/lib/finance/billing';
import {
  buildImportPreview,
  finalizeImport,
  type ConfirmedRow,
  type ExistingInstallmentPlan,
  type FinalizeInput,
  type FinalizeResult,
} from '@/lib/import/pipeline';
import { summarizeStillHeld } from '@/lib/import/still-held';
import { cents } from '@/lib/money';

/**
 * Defeito do plano reprojetado: a fatura SEGUINTE de um parcelamento ja gravado
 * criava outro plano e reprojetava as parcelas futuras com o mesmo dedupe_hash
 * das `planned` do lote anterior — violacao do indice unico
 * (household_id, dedupe_hash) no commit, e o mes contado em dobro.
 *
 * Ponta a ponta na parte pura: a fatura A e finalizada, o "banco" e montado a
 * partir do resultado dela (o que o commit gravaria), e a fatura B e finalizada
 * contra esse banco.
 */

// Santander fecha no dia 10: a fatura de 2026-09 traz 3/10; a de 2026-10, 4/10.
const CARD: CardCycleConfig = { closingDay: 10, dueDay: 20 };
const SOURCE_ID = 'card-1';

function compra(current: number, overrides: Partial<ConfirmedRow> = {}): ConfirmedRow {
  return {
    index: 0,
    include: true,
    occurredOn: '2026-07-05',
    description: 'MAGAZINE SINTETICA',
    rawDescription: `MAGAZINE SINTETICA ${String(current).padStart(2, '0')}/10`,
    amountCents: cents(-10000),
    categoryId: null,
    memberId: null,
    installment: { current, total: 10 },
    ...overrides,
  };
}

function run(
  rows: ConfirmedRow[],
  statementCompetence: Competence,
  extra?: Partial<FinalizeInput>,
): FinalizeResult {
  return finalizeImport({
    rows,
    sourceId: SOURCE_ID,
    sourceKind: 'credit_card',
    cardCycle: CARD,
    existingHashes: new Set<string>(),
    reportedTotalCents: null,
    statementCompetence,
    ...extra,
  });
}

/** Ids sinteticos do que o commit gravaria: `tx-<ref>-<numero>`. */
function txId(ref: number, number: number | null): string {
  return `tx-${String(ref)}-${String(number)}`;
}

/** O que o banco guarda depois de gravar `result`, no formato do contrato. */
function persisted(result: FinalizeResult): {
  plans: ExistingInstallmentPlan[];
  hashes: Set<string>;
} {
  const plans = result.installmentPlans.map((plan) => {
    const rows = result.transactions.filter((t) => t.installmentPlanRef === plan.ref);
    return {
      id: `plan-${String(plan.ref)}`,
      description: plan.description,
      installmentsCount: plan.installmentsCount,
      totalCents: plan.totalCents,
      firstCompetence: plan.firstCompetence,
      openPlanned: rows
        .filter((t) => t.rawDescription === '')
        .map((t) => ({ installmentNumber: t.installmentNumber ?? 0, transactionId: txId(plan.ref, t.installmentNumber) })),
      postedNumbers: rows.filter((t) => t.rawDescription !== '').map((t) => t.installmentNumber ?? 0),
      rawDescriptions: rows.filter((t) => t.rawDescription !== '').map((t) => t.rawDescription),
    };
  });
  return { plans, hashes: new Set(result.transactions.map((t) => t.dedupeHash)) };
}

const primeira = run([compra(3)], '2026-09');
const banco = persisted(primeira);
const contraBanco = { existingHashes: banco.hashes, existingPlans: banco.plans };

describe('finalizeImport — plano existente na fatura seguinte', () => {
  it('a primeira fatura cria o plano e projeta 4/10 a 10/10', () => {
    expect(primeira.installmentPlans).toHaveLength(1);
    expect(primeira.transactions).toHaveLength(8);
  });

  it('a segunda nao cria plano, nao reprojeta e nao colide com hash gravado (indice unico)', () => {
    const segunda = run([compra(4)], '2026-10', contraBanco);
    expect(segunda.installmentPlans).toEqual([]);
    expect(segunda.transactions).toHaveLength(1);
    expect(segunda.transactions.filter((t) => banco.hashes.has(t.dedupeHash))).toEqual([]);
  });

  it('a linha real liga ao plano existente e concilia a planned do mesmo numero', () => {
    const [real] = run([compra(4)], '2026-10', contraBanco).transactions;
    expect(real?.installmentPlanRef).toBeNull();
    expect(real?.installmentPlanId).toBe('plan-1');
    expect(real?.installmentNumber).toBe(4);
    expect(real?.competence).toBe('2026-10');
    expect(real?.reconcilesTransactionId).toBe('tx-1-4');
  });

  it('sem mes contado em dobro: aplicada a conciliacao, cada competencia tem uma parcela do plano', () => {
    const segunda = run([compra(4)], '2026-10', contraBanco);
    const reconciled = new Set(segunda.transactions.map((t) => t.reconcilesTransactionId));
    const ativas = [
      ...primeira.transactions
        .filter((t) => !reconciled.has(txId(1, t.installmentNumber)))
        .map((t) => t.competence),
      ...segunda.transactions.map((t) => t.competence),
    ];
    const porMes = new Map<string, number>();
    for (const competence of ativas) porMes.set(competence, (porMes.get(competence) ?? 0) + 1);
    expect([...porMes.values()].every((count) => count === 1)).toBe(true);
    expect(porMes.size).toBe(8); // 2026-09 (3/10) ate 2026-04 (10/10)
  });

  it('a terceira fatura (5/10) tambem casa, com a 4/10 ja real no banco', () => {
    const segunda = run([compra(4)], '2026-10', contraBanco);
    const [plano] = banco.plans;
    if (plano === undefined) throw new Error('fixture');
    const depoisDaSegunda: ExistingInstallmentPlan = {
      ...plano,
      openPlanned: plano.openPlanned.filter((p) => p.installmentNumber !== 4),
      postedNumbers: [...plano.postedNumbers, 4],
      rawDescriptions: [...(plano.rawDescriptions ?? []), segunda.transactions[0]?.rawDescription ?? ''],
    };
    const terceira = run([compra(5)], '2026-11', { existingPlans: [depoisDaSegunda] });
    expect(terceira.installmentPlans).toEqual([]);
    expect(terceira.transactions[0]?.reconcilesTransactionId).toBe('tx-1-5');
  });

  it('1 centavo de arredondamento por parcela ainda casa', () => {
    const [real] = run([compra(4, { amountCents: cents(-10001) })], '2026-10', contraBanco).transactions;
    expect(real?.installmentPlanId).toBe('plan-1');
  });

  it('descricao trocada a mao no primeiro lote: casa pela descricao original gravada', () => {
    const editada = persisted(run([compra(3, { description: 'Sofa da sala' })], '2026-09'));
    const segunda = run([compra(4)], '2026-10', { existingPlans: editada.plans });
    expect(segunda.installmentPlans).toEqual([]);
    expect(segunda.transactions[0]?.installmentPlanId).toBe('plan-1');
  });

  it('outra compra igual iniciada em outro mes NAO casa', () => {
    const nova = run(
      [compra(1, { occurredOn: '2026-10-01', rawDescription: 'MAGAZINE SINTETICA 01/10' })],
      '2026-10',
      contraBanco,
    );
    expect(nova.installmentPlans).toHaveLength(1);
    expect(nova.transactions.every((t) => t.installmentPlanId === null)).toBe(true);
  });

  it('valor de outra ordem, ou outro total de parcelas, NAO casa', () => {
    const outroValor = run([compra(4, { amountCents: cents(-20000) })], '2026-10', { existingPlans: banco.plans });
    expect(outroValor.installmentPlans).toHaveLength(1);
    const outroTotal = run([compra(4, { installment: { current: 4, total: 12 } })], '2026-10', {
      existingPlans: banco.plans,
    });
    expect(outroTotal.installmentPlans).toHaveLength(1);
  });

  it('numero ja postado no candidato: tenta o proximo candidato com a mesma chave', () => {
    const [plano] = banco.plans;
    if (plano === undefined) throw new Error('fixture');
    // Duas compras identicas no mesmo mes: dois planos com a mesma chave.
    const primeiro = { ...plano, id: 'plan-a', postedNumbers: [3, 4], openPlanned: [] };
    const segundo = { ...plano, id: 'plan-b' };
    const [real] = run([compra(4)], '2026-10', { existingPlans: [primeiro, segundo] }).transactions;
    expect(real?.installmentPlanId).toBe('plan-b');
    expect(real?.reconcilesTransactionId).toBe('tx-1-4');
  });

  it('numero ja postado e sem outro candidato: comportamento atual (plano novo)', () => {
    const [plano] = banco.plans;
    if (plano === undefined) throw new Error('fixture');
    const result = run([compra(4)], '2026-10', { existingPlans: [{ ...plano, postedNumbers: [3, 4] }] });
    expect(result.installmentPlans).toHaveLength(1);
  });

  it('casa sem planned aberta daquele numero: liga ao plano e nao concilia', () => {
    const [plano] = banco.plans;
    if (plano === undefined) throw new Error('fixture');
    const [real] = run([compra(4)], '2026-10', { existingPlans: [{ ...plano, openPlanned: [] }] }).transactions;
    expect(real?.installmentPlanId).toBe('plan-1');
    expect(real?.reconcilesTransactionId).toBeNull();
  });

  it('duas linhas do lote nao conciliam a mesma planned', () => {
    const result = run(
      [compra(4, { index: 0 }), compra(4, { index: 1, occurredOn: '2026-07-06' })],
      '2026-10',
      contraBanco,
    );
    const ids = result.transactions.map((t) => t.reconcilesTransactionId).filter((id) => id !== null);
    expect(ids).toEqual(['tx-1-4']);
  });

  // Achado do Corvo: a reserva "mesma chave vai para o mesmo plano" engolia uma
  // compra NOVA com a mesma descricao e total de parcelas, conforme a ordem.
  for (const ordem of ['plano gravado primeiro', 'compra nova primeiro'] as const) {
    it(`compra nova com a mesma descricao no lote vira plano novo (${ordem})`, () => {
      const daP1 = compra(4, { index: 0 });
      const nova = compra(1, {
        index: 1,
        occurredOn: '2026-10-02',
        rawDescription: 'MAGAZINE SINTETICA 01/10',
        amountCents: cents(-30000),
      });
      const rows = ordem === 'plano gravado primeiro' ? [daP1, nova] : [nova, daP1];
      const result = run(rows, '2026-10', contraBanco);

      const real4 = result.transactions.find((t) => t.installmentNumber === 4 && t.rawDescription !== '');
      expect(real4?.installmentPlanId).toBe('plan-1');
      expect(result.installmentPlans).toHaveLength(1);
      expect(result.installmentPlans[0]?.sourceIndex).toBe(1);
      // As 9 futuras da compra nova estao projetadas: nada some do comprometimento.
      expect(result.transactions.filter((t) => t.rawDescription === '')).toHaveLength(9);
    });

    it(`numero ja postado com um irmao casado no lote nao cai no plano dele (${ordem})`, () => {
      const [plano] = banco.plans;
      if (plano === undefined) throw new Error('fixture');
      const com3Postada = [{ ...plano, postedNumbers: [3] }];
      const casa = compra(4, { index: 0 });
      const jaPostada = compra(3, { index: 1, occurredOn: '2026-07-06' });
      const rows = ordem === 'plano gravado primeiro' ? [casa, jaPostada] : [jaPostada, casa];
      const result = run(rows, '2026-10', { existingPlans: com3Postada });
      const tres = result.transactions.find((t) => t.installmentNumber === 3 && t.rawDescription !== '');
      expect(tres?.installmentPlanId).toBeNull();
      expect(tres?.installmentPlanRef).not.toBeNull();
    });
  }

  it('o preview conta os mesmos planos novos que o finalize cria', () => {
    const rows = [
      compra(4, { index: 0 }),
      compra(1, { index: 1, occurredOn: '2026-10-02', rawDescription: 'MAGAZINE SINTETICA 01/10', amountCents: cents(-30000) }),
    ];
    const preview = buildImportPreview({
      parse: {
        rows: rows.map((row) => ({
          occurredOn: row.occurredOn,
          rawDescription: row.rawDescription,
          amountCents: row.amountCents,
          fitId: null,
          installment: row.installment,
        })),
        diagnostics: [],
        reportedTotalCents: null,
      },
      sourceId: SOURCE_ID,
      sourceKind: 'credit_card',
      cardCycle: CARD,
      rules: [],
      existingHashes: new Set<string>(),
      today: '2026-10-08',
      statementCompetence: '2026-10',
      existingPlans: banco.plans,
    });
    expect(preview.summary.installmentPlansDetected).toBe(run(rows, '2026-10', contraBanco).installmentPlans.length);
  });

  it('sem existingPlans: comportamento atual, campos novos nulos', () => {
    const result = run([compra(4)], '2026-10');
    expect(result.installmentPlans).toHaveLength(1);
    expect(result.transactions.every((t) => t.installmentPlanId === null && t.reconcilesTransactionId === null)).toBe(true);
  });

  it('"Ainda presos": o plano existente nao prende nada de novo', () => {
    expect(summarizeStillHeld(run([compra(4)], '2026-10', contraBanco)).count).toBe(0);
  });
});

describe('buildImportPreview — plano existente', () => {
  it('a linha que casa nao conta como plano novo', () => {
    const preview = buildImportPreview({
      parse: {
        rows: [
          {
            occurredOn: '2026-07-05',
            rawDescription: 'MAGAZINE SINTETICA 04/10',
            amountCents: cents(-10000),
            fitId: null,
            installment: { current: 4, total: 10 },
          },
        ],
        diagnostics: [],
        reportedTotalCents: null,
      },
      sourceId: SOURCE_ID,
      sourceKind: 'credit_card',
      cardCycle: CARD,
      rules: [],
      existingHashes: new Set<string>(),
      today: '2026-10-08',
      statementCompetence: '2026-10',
      existingPlans: banco.plans,
    });
    expect(preview.rows[0]?.installment).toEqual({ current: 4, total: 10 });
    expect(preview.summary.installmentPlansDetected).toBe(0);
  });
});
