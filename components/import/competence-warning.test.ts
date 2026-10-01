import { describe, expect, it } from 'vitest';

import { cardBodySchema } from '@/app/api/cards/schemas';

import { cardPatchBody, competenceMismatch } from './competence-warning';
import { cardsFullResponseSchema } from './schemas';

const due = (date: string) => ({ date, kind: 'due_date' as const });

// Ciclos cadastrados, fechamento/vencimento. O Santander está cadastrado com
// vencimento dia 10, mas a fatura real imprime `Vencimento 07/09/2026` (conferido
// no PDF pelo Orquestrador): o CADASTRO está errado, não a competência.
const NUBANK = { closingDay: 1, dueDay: 9 };
const SANTANDER_CADASTRADO = { closingDay: 1, dueDay: 10 };
const SANTANDER_CORRIGIDO = { closingDay: 1, dueDay: 7 };
const MERCADO_PAGO = { closingDay: 14, dueDay: 20 };

function check(
  cardCycle: { closingDay: number; dueDay: number } | null,
  declaredCompetence: string,
  documentDate: ReturnType<typeof due> | { date: string; kind: 'statement_date' } | null,
  sourceKind: 'credit_card' | 'account' = 'credit_card',
) {
  return competenceMismatch({ sourceKind, cardCycle, declaredCompetence, documentDate });
}

describe('competenceMismatch — importação CORRETA nos três cartões reais não avisa', () => {
  it('Nubank 1/9: competência 2026-09 vence em 2026-09-09', () => {
    expect(check(NUBANK, '2026-09', due('2026-09-09'))).toBeNull();
  });
  it('Santander com o cadastro CORRIGIDO (1/7): 2026-09 vence em 2026-09-07', () => {
    expect(check(SANTANDER_CORRIGIDO, '2026-09', due('2026-09-07'))).toBeNull();
  });
  it('Mercado Pago 14/20: competência 2026-07 vence em 2026-07-20', () => {
    expect(check(MERCADO_PAGO, '2026-07', due('2026-07-20'))).toBeNull();
  });
});

describe('competenceMismatch — COMPETÊNCIA errada: o engano real do Ricardo', () => {
  it('MP declarado 2026-09, documento imprime 2026-07-20: kind competence, com as TRÊS datas', () => {
    expect(check(MERCADO_PAGO, '2026-09', due('2026-07-20'))).toEqual({
      kind: 'competence',
      printedDueDate: '2026-07-20',
      declaredCompetence: '2026-09',
      expectedDueDate: '2026-09-20',
      registeredDueDay: 20,
      fix: null,
    });
  });

  it('erro de competência NUNCA oferece conserto de cartão', () => {
    expect(check(MERCADO_PAGO, '2026-09', due('2026-07-20'))?.fix).toBeNull();
  });
});

describe('competenceMismatch — CADASTRO do cartão errado: o caso Santander real', () => {
  it('competência 2026-09 CERTA, ciclo 1/10 cadastrado, documento imprime 2026-09-07: aviso de CADASTRO, nunca de competência', () => {
    const mismatch = check(SANTANDER_CADASTRADO, '2026-09', due('2026-09-07'));
    expect(mismatch).toEqual({
      kind: 'registration',
      printedDueDate: '2026-09-07',
      declaredCompetence: '2026-09',
      expectedDueDate: '2026-09-10',
      registeredDueDay: 10,
      // Com o dia 7 no lugar do 10 (fechamento 1 intocado), 2026-09 passa a vencer
      // exatamente em 2026-09-07: a evidência sustenta a correção.
      fix: { dueDay: 7 },
    });
    expect(mismatch?.kind).not.toBe('competence');
  });

  it('não oferece conserto quando o dia impresso NÃO resolve o ciclo (fechamento provavelmente errado também)', () => {
    // Fechamento 15, vencimento 20, competência 2026-09 → esperado 2026-09-20.
    // Impresso 2026-09-12: mesmo mês, mas com dia 12 (< fechamento 15) o vencimento
    // iria para 2026-10-12. Corrigir o dia não faria o aviso sumir → sem botão.
    const mismatch = check({ closingDay: 15, dueDay: 20 }, '2026-09', due('2026-09-12'));
    expect(mismatch?.kind).toBe('registration');
    expect(mismatch?.fix).toBeNull();
  });

  it('o mesmo cartão com a competência realmente errada continua sendo aviso de competência', () => {
    // Cadastro 1/10 e documento do mês 08 impresso 2026-08-10 (certo p/ o cadastro), declarado 09.
    expect(check(SANTANDER_CADASTRADO, '2026-09', due('2026-08-10'))?.kind).toBe('competence');
  });
});

describe('competenceMismatch — causa indistinguível', () => {
  it('data que não é de nenhuma competência próxima e cai em outro mês: unclear, sem culpar ninguém', () => {
    // Vencimento cadastrado dia 31 (fechamento 15); impresso 2026-04-01 não é o
    // vencimento de nenhuma competência desse ciclo e não está no mês esperado (03-31).
    expect(check({ closingDay: 15, dueDay: 31 }, '2026-03', due('2026-04-01'))?.kind).toBe('unclear');
  });
});

describe('competenceMismatch — compara DATAS, não meses', () => {
  it('fechamento 25 / vencimento 5: a competência 09 vence em OUTUBRO e isso é correto', () => {
    // Por mês (09 ≠ 10) isto gritaria; por data (esperado 2026-10-05 === impresso) não.
    expect(check({ closingDay: 25, dueDay: 5 }, '2026-09', due('2026-10-05'))).toBeNull();
  });

  it('o mesmo cartão, competência errada por um mês, avisa', () => {
    const mismatch = check({ closingDay: 25, dueDay: 5 }, '2026-10', due('2026-10-05'));
    expect(mismatch?.expectedDueDate).toBe('2026-11-05');
  });

  it('virada de ano: fechamento 25 / vencimento 5, competência 2026-12 vence em 2027-01-05', () => {
    expect(check({ closingDay: 25, dueDay: 5 }, '2026-12', due('2027-01-05'))).toBeNull();
  });

  it('dia 31 em mês curto é ajustado para o último dia (a regra é do billing)', () => {
    // fechamento 15, vencimento 31, competência 2026-02 → vence em 2026-02-28.
    expect(check({ closingDay: 15, dueDay: 31 }, '2026-02', due('2026-02-28'))).toBeNull();
  });
});

describe('competenceMismatch — quando não há o que comparar, não mostra nada', () => {
  it('documentDate nulo (texto colado, PDF sem cabeçalho): sem aviso', () => {
    expect(check(MERCADO_PAGO, '2026-09', null)).toBeNull();
  });

  it('origem conta: sem ciclo, sem aviso', () => {
    expect(check(null, '2026-09', due('2026-07-20'), 'account')).toBeNull();
  });

  it('cartão sem ciclo conhecido: sem aviso', () => {
    expect(check(null, '2026-09', due('2026-07-20'))).toBeNull();
  });

  it('statement_date não é vencimento: não é comparado (evita falso alarme)', () => {
    expect(check(NUBANK, '2026-09', { date: '2026-08-02', kind: 'statement_date' })).toBeNull();
  });
});

describe('cardPatchBody — corrigir SÓ o vencimento sem zerar o resto do cartão', () => {
  const santander = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'SANTANDER',
    bank: 'Santander',
    brand: 'visa' as const,
    holderMemberId: '33333333-3333-4333-8333-333333333333',
    paymentAccountId: '44444444-4444-4444-8444-444444444444',
    creditLimitCents: 1_500_000,
    closingDay: 1,
    dueDay: 10,
  };

  it('só dueDay muda; banco, titular, conta de pagamento, limite e fechamento seguem como estavam', () => {
    expect(cardPatchBody(santander, 7)).toEqual({
      name: 'SANTANDER',
      bank: 'Santander',
      brand: 'visa',
      holderMemberId: '33333333-3333-4333-8333-333333333333',
      paymentAccountId: '44444444-4444-4444-8444-444444444444',
      creditLimitCents: 1_500_000,
      closingDay: 1,
      dueDay: 7,
    });
  });

  it('o corpo passa no schema REAL da rota e não perde nenhum campo opcional (a rota substitui o cartão inteiro)', () => {
    const parsed = cardBodySchema.parse(cardPatchBody(santander, 7));
    expect(parsed.bank).toBe('Santander');
    expect(parsed.holderMemberId).toBe(santander.holderMemberId);
    expect(parsed.paymentAccountId).toBe(santander.paymentAccountId);
    expect(parsed.creditLimitCents).toBe(1_500_000);
    expect(parsed.dueDay).toBe(7);
  });

  it('cartão sem limite, banco ou titular continua válido', () => {
    const bare = { ...santander, bank: null, holderMemberId: null, paymentAccountId: null, creditLimitCents: null };
    expect(() => cardBodySchema.parse(cardPatchBody(bare, 7))).not.toThrow();
  });

  it('a resposta de GET /api/cards (com `statements` e `members` a mais) é lida sem perder os campos do PATCH', () => {
    const response = {
      cards: [{ ...santander, active: true, statements: [{ id: 'x', period: '2026-09' }] }],
      members: [{ id: 'm', name: 'Ricardo' }],
    };
    const [card] = cardsFullResponseSchema.parse(response).cards;
    expect(card).toEqual(santander);
  });
});
