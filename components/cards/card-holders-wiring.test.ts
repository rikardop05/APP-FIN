import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cardListSchema } from './schemas';

/**
 * Liga "Finais e responsáveis" (decisão 20) à tela de cartões. A regra está em `holders.test.ts`;
 * aqui se trava a ligação (o vitest roda em Node, sem navegador, então a checagem é no fonte e no zod).
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const CARD = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Mercado Pago',
  bank: null,
  brand: 'mastercard',
  holderMemberId: null,
  paymentAccountId: null,
  creditLimitCents: null,
  closingDay: 1,
  dueDay: 7,
  active: true,
  statements: [],
};
const MEMBER = '22222222-2222-4222-8222-222222222222';

describe('finais e responsáveis na tela de cartões', () => {
  it('a seção aparece em CADA cartão e a tela adota a lista devolvida pela API', () => {
    const screen = read('components/cards/cartoes-screen.tsx');
    expect(screen).toContain('<CardHolders');
    expect(screen).toContain('card={card}');
    expect(screen).toContain('setCards(next.cards)');
  });

  it('usa as rotas combinadas: PUT /holders (upsert) e DELETE /holders/[id]', () => {
    const component = read('components/cards/card-holders.tsx');
    expect(component).toContain('`/api/cards/${card.id}/holders`');
    expect(component).toContain("method: 'PUT'");
    expect(component).toContain('`/api/cards/${card.id}/holders/${row.id}`');
    expect(component).toContain("method: 'DELETE'");
  });

  it('a nota de que só o Mercado Pago imprime o final aparece na seção', () => {
    expect(read('components/cards/card-holders.tsx')).toContain('{HOLDERS_NOTE}');
  });

  it('o zod aceita cartão COM finais e SEM o campo (API antiga): sem finais, não erro', () => {
    const withHolders = cardListSchema.parse({
      cards: [{ ...CARD, holders: [{ id: '33333333-3333-4333-8333-333333333333', last4: '4239', memberId: MEMBER }] }],
      members: [{ id: MEMBER, name: 'Ricardo' }],
    });
    expect(withHolders.cards[0]?.holders).toEqual([
      { id: '33333333-3333-4333-8333-333333333333', last4: '4239', memberId: MEMBER },
    ]);
    const without = cardListSchema.parse({ cards: [CARD], members: [] });
    expect(without.cards[0]?.holders).toEqual([]);
  });
});
