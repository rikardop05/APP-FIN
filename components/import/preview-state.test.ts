import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';

import { previewSchema } from './schemas';
import { defaultInclude, includedByDefaultCount, stateLabel } from './preview-state';

describe('linha informativa na prévia (decisão 8)', () => {
  it('chega DESMARCADA: informativa, duplicada e pagamento de fatura; o resto entra marcado', () => {
    expect(defaultInclude('informational')).toBe(false);
    expect(defaultInclude('duplicate')).toBe(false);
    expect(defaultInclude('credit_card_payment')).toBe(false);
    for (const state of ['new', 'installment_first', 'installment_part'] as const) {
      expect(defaultInclude(state), state).toBe(true);
    }
  });

  it('o rótulo da linha informativa é "Informativa"; os demais seguem como eram', () => {
    expect(stateLabel('informational')).toBe('Informativa');
    expect(stateLabel('duplicate')).toBe('Duplicada');
    expect(stateLabel('credit_card_payment')).toBe('Pagamento');
    expect(stateLabel('installment_first')).toBe('Parcelada');
    expect(stateLabel('installment_part')).toBe('Parcelada');
    expect(stateLabel('new')).toBe('Nova');
  });

  it('o contador inicial de incluídas usa a mesma regra do formulário (não conta a informativa)', () => {
    const rows = [
      { state: 'new' },
      { state: 'informational' },
      { state: 'duplicate' },
      { state: 'installment_first' },
      { state: 'credit_card_payment' },
    ] as const;
    expect(includedByDefaultCount(rows)).toBe(2);
  });
});

describe('espelho zod aceita o estado informational', () => {
  it('a resposta do upload com uma linha informativa passa no parse (não quebra por estado novo)', () => {
    const row = {
      index: 0,
      occurredOn: '2026-09-10',
      competence: '2026-09',
      description: 'ANUIDADE DIFERENCIADA',
      rawDescription: 'ANUIDADE DIFERENCIADA 01/12',
      amountCents: cents(0),
      dedupeHash: null,
      suggestedCategoryId: null,
      suggestedMemberId: null,
      state: 'informational',
      installment: { current: 1, total: 12 },
    };
    const parsed = previewSchema.shape.rows.safeParse([row]);
    expect(parsed.success).toBe(true);
  });
});
