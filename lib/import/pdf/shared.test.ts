import { describe, expect, it } from 'vitest';

import { PDF_MONEY_TOKEN, yearForDateWithoutYear } from '@/lib/import/pdf/shared';
import { MINUS_DASH_CODE_POINTS, cents, parseBRL } from '@/lib/money';

/** Traço como string, a partir do code point. */
function dashChar(codePoint: number): string {
  return String.fromCodePoint(codePoint);
}

describe('shared — token monetario alinhado com a lista unica de lib/money', () => {
  it('cobre CADA traco de MINUS_DASH_CODE_POINTS, no token e no parseBRL', () => {
    // Se um traco for acrescentado a lista do Esquadro, o token (montado da
    // classe derivada) ja o cobre — este teste quebra se alguem re-hardcodar a
    // classe em shared.ts e esquecer um.
    for (const codePoint of MINUS_DASH_CODE_POINTS) {
      const text = `${dashChar(codePoint)}R$ 1.208,96`;
      expect(parseBRL(text)).toBe(cents(-120896));
      expect([...text.matchAll(PDF_MONEY_TOKEN)].map((match) => match[0])).toEqual([
        text,
      ]);
    }
  });

  it('registra a lista decidida (quebra se lib/money mudar sem revisao)', () => {
    expect(MINUS_DASH_CODE_POINTS).toEqual([
      0x002d, 0x2010, 0x2011, 0x2013, 0x2212, 0xff0d,
    ]);
  });

  it('deixa de fora U+2012 e U+2014 (travessao de prosa, arbitragem do Esquadro)', () => {
    for (const codePoint of [0x2012, 0x2014]) {
      expect(parseBRL(`${dashChar(codePoint)}R$ 1.208,96`)).toBeNull();
    }
  });

  it('nao confunde valor positivo', () => {
    expect(parseBRL('R$ 9,99')).toBe(cents(999));
  });
});

describe('shared — virada de ano', () => {
  const reference = { year: 2026, month: 7, day: 20 };

  it('data estritamente depois da referencia vai para o ano anterior', () => {
    expect(
      yearForDateWithoutYear({ month: 11, day: 24, reference, fallbackYear: null }),
    ).toBe(2025);
    expect(
      yearForDateWithoutYear({ month: 7, day: 21, reference, fallbackYear: null }),
    ).toBe(2025);
  });

  it('data antes ou na referencia fica no ano dela', () => {
    expect(
      yearForDateWithoutYear({ month: 5, day: 3, reference, fallbackYear: null }),
    ).toBe(2026);
    expect(
      yearForDateWithoutYear({ month: 7, day: 20, reference, fallbackYear: null }),
    ).toBe(2026);
  });

  it('sem referencia, usa o ano do chamador sem virar; sem nada, null', () => {
    expect(
      yearForDateWithoutYear({ month: 11, day: 24, reference: null, fallbackYear: 2026 }),
    ).toBe(2026);
    expect(
      yearForDateWithoutYear({ month: 11, day: 24, reference: null, fallbackYear: null }),
    ).toBeNull();
  });
});
