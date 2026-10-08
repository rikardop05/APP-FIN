import { describe, expect, it } from 'vitest';
import { cardHolderBodySchema, cardHolderIdSchema } from './schemas';

const memberId = '3694b0c7-d361-599a-94dd-f1ec08835cbe';

describe('PUT /api/cards/[id]/holders — corpo', () => {
  it('aceita { last4, memberId } com 4 dígitos', () => {
    expect(cardHolderBodySchema.parse({ last4: '4239', memberId })).toEqual({ last4: '4239', memberId });
  });

  it('apara espaço em volta do final', () => {
    expect(cardHolderBodySchema.parse({ last4: ' 0007 ', memberId }).last4).toBe('0007');
  });

  it.each(['123', '12345', 'abcd', '12 4', '', 4239])('recusa final %j', (last4) => {
    expect(cardHolderBodySchema.safeParse({ last4, memberId }).success).toBe(false);
  });

  it('recusa membro que não é uuid e campo a mais', () => {
    expect(cardHolderBodySchema.safeParse({ last4: '4239', memberId: 'ana' }).success).toBe(false);
    expect(cardHolderBodySchema.safeParse({ last4: '4239', memberId, extra: 1 }).success).toBe(false);
  });

  it('id do mapeamento é uuid', () => {
    expect(cardHolderIdSchema.safeParse(memberId).success).toBe(true);
    expect(cardHolderIdSchema.safeParse('x').success).toBe(false);
  });
});
