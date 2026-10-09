import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';

import { parcelaLabel, placarTone, seloLetter, SELO_TONE_CLASS } from './carne';

describe('numeração de parcela (canhoto 03/10)', () => {
  it('sempre com dois dígitos, na face condensada: 3/10 vira 03/10', () => {
    expect(parcelaLabel(3, 10)).toBe('03/10');
    expect(parcelaLabel(1, 12)).toBe('01/12');
    expect(parcelaLabel(12, 12)).toBe('12/12');
  });

  it('passa de 99: o número acompanha, sem cortar', () => {
    expect(parcelaLabel(5, 120)).toBe('005/120');
  });

  it('recusa parcela fora de 1..total e valores que não são inteiros', () => {
    expect(() => parcelaLabel(0, 10)).toThrow(RangeError);
    expect(() => parcelaLabel(11, 10)).toThrow(RangeError);
    expect(() => parcelaLabel(1.5, 10)).toThrow(RangeError);
    expect(() => parcelaLabel(1, Number.NaN)).toThrow(RangeError);
  });
});

describe('carimbo do placar: confere quando a diferença zera, diverge quando não', () => {
  it('diferença zero = ok; qualquer centavo de diferença = perigo; sem total impresso = neutro', () => {
    expect(placarTone(cents(0))).toBe('ok');
    expect(placarTone(cents(1))).toBe('danger');
    expect(placarTone(cents(-3414))).toBe('danger');
    expect(placarTone(null)).toBe('neutral');
  });
});

describe('selo de estado: a letra carrega o estado além da cor', () => {
  it('uma letra só, maiúscula', () => {
    expect(seloLetter('n')).toBe('N');
    expect(seloLetter('!')).toBe('!');
    expect(seloLetter('Duplicada')).toBe('D');
  });

  it('vazio não vira selo sem letra: lança', () => {
    expect(() => seloLetter('')).toThrow(RangeError);
    expect(() => seloLetter('   ')).toThrow(RangeError);
  });

  it('todo tom tem classes próprias e nenhum usa o vermelho de despesa: só danger usa o carimbo', () => {
    expect(Object.keys(SELO_TONE_CLASS).sort()).toEqual(['attention', 'danger', 'neutral', 'ok']);
    for (const [tone, classes] of Object.entries(SELO_TONE_CLASS)) {
      if (tone === 'danger') expect(classes.box).toContain('destructive');
      else expect(classes.box, tone).not.toContain('destructive');
    }
  });
});

import { dataTalao } from './carne';

describe('dataTalao: data do talão sem barra, para não confundir com n/N', () => {
  it('formata dd mmm', () => {
    expect(dataTalao('2026-10-04')).toBe('04 out');
    expect(dataTalao('2026-12-31')).toBe('31 dez');
    expect(dataTalao('2026-03-01')).toBe('01 mar');
  });

  it('rejeita data inválida', () => {
    expect(() => dataTalao('2026-13-01')).toThrow(RangeError);
    expect(() => dataTalao('04/10/2026')).toThrow(RangeError);
  });
});

import { ESTADO_LETRA, letraDoEstado } from './carne';
import { FLAG_SELO } from '@/components/import/review-model';
import { batchStatusLabel } from '@/components/import/import-history-text';

describe('letra única por estado no app todo', () => {
  it('a tabela não repete letra', () => {
    const letters = Object.values(ESTADO_LETRA);
    expect(new Set(letters).size).toBe(letters.length);
    for (const letter of letters) expect(letter).toMatch(/^[A-Z]$/);
  });

  it('todo estado de Importar e do histórico está na tabela', () => {
    for (const { label } of Object.values(FLAG_SELO)) expect(ESTADO_LETRA[label], label).toBeDefined();
    for (const status of ['pending', 'committed', 'reverted', 'failed'] as const) {
      const label = batchStatusLabel(status);
      expect(ESTADO_LETRA[label], label).toBeDefined();
    }
    expect(ESTADO_LETRA['Previsto']).toBeDefined();
    expect(ESTADO_LETRA['Não categorizado']).toBeDefined();
  });

  it('os que colidiam agora são diferentes', () => {
    expect(letraDoEstado('Não categorizado')).not.toBe(letraDoEstado('Não paga'));
    expect(letraDoEstado('Informativa')).not.toBe(letraDoEstado('Não categorizado'));
    expect(letraDoEstado('Previsto')).not.toBe(letraDoEstado('Pagamento'));
  });

  it('estado novo sem entrada cai na inicial', () => {
    expect(letraDoEstado('Zeta novo')).toBe('Z');
  });
});
