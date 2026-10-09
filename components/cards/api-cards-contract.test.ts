import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cardsFullResponseSchema, cardsResponseSchema } from '@/components/import/schemas';

import { cardListSchema } from './schemas';

/**
 * Trava o contrato de `GET /api/cards` entre as DUAS telas que o leem (Cartões e Importar). O corpo
 * abaixo imita a resposta de produção (2026-10-09) e acrescenta os caminhos que lá ainda não existem
 * (fatura paga e fechada, final de cartão com responsável). Se um campo novo fizer um dos schemas rejeitar a resposta, Cartões fica em "Carregando…"
 * e Importar mostra "Nenhum cartão ativo": aqui o teste fica vermelho antes disso chegar à tela.
 */
const BODY = {
  cards: [
    {
      id: 'ea140305-d9de-49f3-b888-530e3e1e33c9',
      name: 'MP',
      bank: 'MP',
      brand: 'visa',
      holderMemberId: null,
      paymentAccountId: null,
      creditLimitCents: null,
      closingDay: 14,
      dueDay: 20,
      active: true,
      statements: [
        {
          id: '97137a28-1f84-48f2-934b-816346d7a8b8',
          period: '2026-07',
          closingDate: '2026-07-14',
          dueDate: '2026-07-20',
          reportedTotalCents: null,
          computedTotalCents: -146901,
          differenceCents: null,
          status: 'open',
          source: 'import',
        },
        {
          id: '16a31f03-d495-4d79-aba8-3d6cdf33267d',
          period: '2026-08',
          closingDate: '2026-08-14',
          dueDate: '2026-08-20',
          reportedTotalCents: 150000,
          computedTotalCents: -150000,
          differenceCents: 0,
          status: 'paid',
          source: 'generated',
        },
        {
          id: '0b7d1c2e-3f4a-4b5c-8d6e-7f8091a2b3c4',
          period: '2026-09',
          closingDate: '2026-09-14',
          dueDate: '2026-09-20',
          reportedTotalCents: null,
          computedTotalCents: -90000,
          differenceCents: null,
          status: 'closed',
          source: 'manual',
        },
      ],
      holders: [{ id: '5a1f6b0e-1c7e-4d6b-9a55-0c1f2b3a4d5e', last4: '1234', memberId: '3232dddc-3c7f-502a-bab4-172b511dd807' }],
    },
  ],
  members: [{ id: '3232dddc-3c7f-502a-bab4-172b511dd807', name: 'Ricardo' }],
};

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('GET /api/cards: as duas telas aceitam a resposta real', () => {
  it('Cartões (cardListSchema) aceita fatura aberta, paga e gerada', () => {
    expect(cardListSchema.safeParse(BODY).success).toBe(true);
  });

  it('Importar (cardsResponseSchema e cardsFullResponseSchema) aceita a mesma resposta', () => {
    expect(cardsResponseSchema.safeParse(BODY).success).toBe(true);
    expect(cardsFullResponseSchema.safeParse(BODY).success).toBe(true);
  });
});

describe('Cartões não entra em laço de carregamento', () => {
  const screen = read('components/cards/cartoes-screen.tsx');

  it('o carregamento é um callback estável (sem dependências) chamado uma vez pelo efeito', () => {
    expect(screen).toMatch(/const load = useCallback\(async \(silent = false\) => \{[\s\S]*?\},\s*\[\]\);/);
    expect(screen).toMatch(/useEffect\(\(\) => \{\s*void load\(\);\s*\},\s*\[load\]\);/);
  });

  it('a marca de fatura paga recarrega em silêncio, sem trocar a lista por "Carregando"', () => {
    expect(screen).toContain('if (!silent) setLoading(true);');
    expect(screen).toContain('void load(true);');
  });
});
