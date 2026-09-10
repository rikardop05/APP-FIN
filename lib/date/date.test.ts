import { describe, expect, it } from 'vitest';

import {
  addCompetence,
  clampDayToMonth,
  competenceEnd,
  competenceRange,
  competenceStart,
  diffMonths,
  formatDateBR,
  toCompetence,
} from '@/lib/date';

describe('toCompetence', () => {
  it('corta o dia', () => {
    expect(toCompetence('2026-09-10')).toBe('2026-09');
    expect(toCompetence('2026-01-01')).toBe('2026-01');
    expect(toCompetence('2026-12-31')).toBe('2026-12');
  });

  it('recusa data que nao existe no calendario em vez de deslizar para o mes seguinte', () => {
    expect(() => toCompetence('2026-02-30')).toThrow(RangeError);
    // 2026 nao e bissexto (2026 / 4 = 506,5), entao 29/02 nao existe.
    expect(() => toCompetence('2026-02-29')).toThrow(RangeError);
    expect(() => toCompetence('2026-04-31')).toThrow(RangeError);
  });

  it('aceita 29/02 em ano bissexto', () => {
    // 2024 e divisivel por 4 e nao por 100.
    expect(toCompetence('2024-02-29')).toBe('2024-02');
  });

  it('recusa ano abaixo de 1000 em vez de devolver competencia malformada', () => {
    // '0999-01-01' seria lido como ano 999 e devolveria '999-01', string de 3
    // digitos que competenceStart, addCompetence e diffMonths rejeitam. O
    // modulo nao pode emitir valor que ele proprio nao consome.
    expect(() => toCompetence('0999-01-01')).toThrow(RangeError);
    expect(() => toCompetence('0001-01-01')).toThrow(RangeError);
    expect(() => competenceStart('0999-01')).toThrow(RangeError);
    expect(() => competenceEnd('0001-05')).toThrow(RangeError);
    expect(() => formatDateBR('0999-01-01')).toThrow(RangeError);
    expect(() => diffMonths('0999-01', '2026-01')).toThrow(RangeError);
  });

  it('recusa forma invalida', () => {
    expect(() => toCompetence('20260910')).toThrow(RangeError);
    expect(() => toCompetence('2026-9-10')).toThrow(RangeError);
    expect(() => toCompetence('2026-13-01')).toThrow(RangeError);
    expect(() => toCompetence('2026-00-10')).toThrow(RangeError);
    expect(() => toCompetence('2026-09')).toThrow(RangeError);
    expect(() => toCompetence('')).toThrow(RangeError);
  });
});

describe('competenceStart', () => {
  it('devolve o dia 1', () => {
    expect(competenceStart('2026-02')).toBe('2026-02-01');
    expect(competenceStart('2026-12')).toBe('2026-12-01');
  });

  it('recusa competencia invalida', () => {
    expect(() => competenceStart('2026-13')).toThrow(RangeError);
    expect(() => competenceStart('2026-09-10')).toThrow(RangeError);
  });
});

describe('competenceEnd', () => {
  it('mes de 31 dias', () => {
    expect(competenceEnd('2026-01')).toBe('2026-01-31');
    expect(competenceEnd('2026-07')).toBe('2026-07-31');
    expect(competenceEnd('2026-12')).toBe('2026-12-31');
  });

  it('mes de 30 dias', () => {
    expect(competenceEnd('2026-04')).toBe('2026-04-30');
    expect(competenceEnd('2026-06')).toBe('2026-06-30');
    expect(competenceEnd('2026-09')).toBe('2026-09-30');
    expect(competenceEnd('2026-11')).toBe('2026-11-30');
  });

  it('fevereiro de 28 dias em ano comum', () => {
    // 2026 / 4 = 506,5 -> nao e bissexto.
    expect(competenceEnd('2026-02')).toBe('2026-02-28');
    // 2025 / 4 = 506,25 -> nao e bissexto.
    expect(competenceEnd('2025-02')).toBe('2025-02-28');
  });

  it('fevereiro de 29 dias em ano bissexto', () => {
    // 2024 divisivel por 4, nao por 100.
    expect(competenceEnd('2024-02')).toBe('2024-02-29');
    // 2028 idem.
    expect(competenceEnd('2028-02')).toBe('2028-02-29');
  });

  it('aplica a regra dos seculos', () => {
    // 1900 e divisivel por 100 e nao por 400 -> NAO e bissexto.
    expect(competenceEnd('1900-02')).toBe('1900-02-28');
    // 2000 e divisivel por 400 -> e bissexto.
    expect(competenceEnd('2000-02')).toBe('2000-02-29');
    // 2100 divisivel por 100 e nao por 400 -> nao e bissexto.
    expect(competenceEnd('2100-02')).toBe('2100-02-28');
  });
});

describe('addCompetence', () => {
  it('soma dentro do mesmo ano', () => {
    expect(addCompetence('2026-01', 2)).toBe('2026-03');
    expect(addCompetence('2026-09', 0)).toBe('2026-09');
  });

  it('cruza a virada de ano para frente', () => {
    // dez/2026 + 1 = jan/2027.
    expect(addCompetence('2026-12', 1)).toBe('2027-01');
    // nov/2026 + 3 = fev/2027.
    expect(addCompetence('2026-11', 3)).toBe('2027-02');
  });

  it('cruza a virada de ano para tras', () => {
    // jan/2026 - 1 = dez/2025.
    expect(addCompetence('2026-01', -1)).toBe('2025-12');
    // fev/2026 - 3 = nov/2025.
    expect(addCompetence('2026-02', -3)).toBe('2025-11');
  });

  it('soma multiplo de 12 mantem o mes', () => {
    expect(addCompetence('2026-03', 12)).toBe('2027-03');
    expect(addCompetence('2026-03', -24)).toBe('2024-03');
  });

  it('atravessa mais de um ano para tras', () => {
    // mar/2026 - 12 = mar/2025; - 3 = dez/2024.
    expect(addCompetence('2026-03', -15)).toBe('2024-12');
  });

  it('atravessa mais de um ano para frente', () => {
    // jan/2026 + 12 = jan/2027; + 11 = dez/2027.
    expect(addCompetence('2026-01', 23)).toBe('2027-12');
    // jan/2026 + 24 = jan/2028.
    expect(addCompetence('2026-01', 24)).toBe('2028-01');
  });

  it('recusa sair do intervalo de ano suportado, nas duas pontas', () => {
    // Entrada e saida usam o mesmo intervalo 1000-9999: nada sai daqui em
    // forma que a propria funcao nao aceitaria de volta.
    expect(() => addCompetence('1000-01', -1)).toThrow(RangeError);
    expect(() => addCompetence('9999-12', 1)).toThrow(RangeError);
  });

  it('recusa deslocamento nao inteiro', () => {
    expect(() => addCompetence('2026-01', 1.5)).toThrow(RangeError);
    expect(() => addCompetence('2026-01', Number.NaN)).toThrow(RangeError);
  });
});

describe('competenceRange', () => {
  it('devolve meses consecutivos cruzando a virada de ano', () => {
    expect(competenceRange('2026-11', 4)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  it('inclui a competencia inicial e tem exatamente o tamanho pedido', () => {
    const range = competenceRange('2026-01', 12);
    expect(range).toHaveLength(12);
    expect(range[0]).toBe('2026-01');
    // 12 meses a partir de jan/2026 termina em dez/2026.
    expect(range[11]).toBe('2026-12');
  });

  it('zero meses devolve lista vazia', () => {
    expect(competenceRange('2026-01', 0)).toEqual([]);
  });

  it('um mes devolve so a competencia inicial', () => {
    expect(competenceRange('2026-01', 1)).toEqual(['2026-01']);
  });

  it('recusa quantidade negativa ou fracionaria', () => {
    expect(() => competenceRange('2026-01', -1)).toThrow(RangeError);
    expect(() => competenceRange('2026-01', 2.5)).toThrow(RangeError);
  });
});

describe('clampDayToMonth', () => {
  it('mantem o dia quando ele existe no mes', () => {
    expect(clampDayToMonth(2026, 1, 31)).toBe('2026-01-31');
    expect(clampDayToMonth(2026, 9, 15)).toBe('2026-09-15');
  });

  it('dia 31 em fevereiro de ano comum vira 28', () => {
    // 2026 nao e bissexto.
    expect(clampDayToMonth(2026, 2, 31)).toBe('2026-02-28');
    expect(clampDayToMonth(2026, 2, 30)).toBe('2026-02-28');
    expect(clampDayToMonth(2026, 2, 29)).toBe('2026-02-28');
  });

  it('dia 31 em fevereiro de ano bissexto vira 29', () => {
    // 2024 e bissexto.
    expect(clampDayToMonth(2024, 2, 31)).toBe('2024-02-29');
    expect(clampDayToMonth(2024, 2, 29)).toBe('2024-02-29');
  });

  it('dia 31 em mes de 30 dias vira 30', () => {
    expect(clampDayToMonth(2026, 4, 31)).toBe('2026-04-30');
    expect(clampDayToMonth(2026, 11, 31)).toBe('2026-11-30');
  });

  it('preenche com zero a esquerda', () => {
    expect(clampDayToMonth(2026, 9, 5)).toBe('2026-09-05');
    expect(clampDayToMonth(2026, 12, 1)).toBe('2026-12-01');
  });

  it('clampa tambem na ponta de baixo', () => {
    expect(clampDayToMonth(2026, 2, 0)).toBe('2026-02-01');
    expect(clampDayToMonth(2026, 2, -5)).toBe('2026-02-01');
  });

  it('recusa mes fora de 1-12 e valor nao inteiro', () => {
    expect(() => clampDayToMonth(2026, 0, 1)).toThrow(RangeError);
    expect(() => clampDayToMonth(2026, 13, 1)).toThrow(RangeError);
    expect(() => clampDayToMonth(2026, 2.5, 1)).toThrow(RangeError);
    expect(() => clampDayToMonth(2026, 2, 1.5)).toThrow(RangeError);
    expect(() => clampDayToMonth(26, 2, 1)).toThrow(RangeError);
  });

  it('o resultado e uma data valida que toCompetence aceita', () => {
    expect(toCompetence(clampDayToMonth(2026, 2, 31))).toBe('2026-02');
  });
});

describe('formatDateBR', () => {
  it('inverte a ordem e troca o separador', () => {
    expect(formatDateBR('2026-09-10')).toBe('10/09/2026');
    expect(formatDateBR('2024-02-29')).toBe('29/02/2024');
    expect(formatDateBR('2026-01-01')).toBe('01/01/2026');
  });

  it('nao desloca o dia por fuso: 2026-09-10 nunca exibe 09/09/2026', () => {
    // Uma data sem hora convertida via UTC -> America/Sao_Paulo (-3h) voltaria
    // um dia. Este teste existe para travar essa regressao.
    expect(formatDateBR('2026-09-10')).toBe('10/09/2026');
    expect(formatDateBR('2026-01-01')).toBe('01/01/2026');
  });

  it('recusa data invalida', () => {
    expect(() => formatDateBR('2026-02-30')).toThrow(RangeError);
    expect(() => formatDateBR('10/09/2026')).toThrow(RangeError);
    expect(() => formatDateBR('2026-09')).toThrow(RangeError);
  });
});

describe('diffMonths', () => {
  it('positivo quando a primeira competencia e a mais recente', () => {
    // mar/2026 - jan/2026 = 2 meses.
    expect(diffMonths('2026-03', '2026-01')).toBe(2);
  });

  it('negativo quando a primeira competencia e a mais antiga', () => {
    // jan/2026 - mar/2026 = -2 meses.
    expect(diffMonths('2026-01', '2026-03')).toBe(-2);
  });

  it('zero para a mesma competencia', () => {
    expect(diffMonths('2026-05', '2026-05')).toBe(0);
  });

  it('cruza a virada de ano nos dois sentidos', () => {
    // jan/2027 - dez/2026 = 1.
    expect(diffMonths('2027-01', '2026-12')).toBe(1);
    // dez/2026 - jan/2027 = -1.
    expect(diffMonths('2026-12', '2027-01')).toBe(-1);
    // jan/2026 - jan/2025 = 12.
    expect(diffMonths('2026-01', '2025-01')).toBe(12);
    // jan/2025 - mar/2026 = -(12 + 2) = -14.
    expect(diffMonths('2025-01', '2026-03')).toBe(-14);
  });

  it('e o inverso de addCompetence — invariante que fixa o sentido', () => {
    // addCompetence(b, diffMonths(a, b)) === a.
    expect(addCompetence('2026-01', diffMonths('2027-05', '2026-01'))).toBe(
      '2027-05',
    );
    expect(addCompetence('2027-05', diffMonths('2026-01', '2027-05'))).toBe(
      '2026-01',
    );
  });

  it('recusa competencia invalida', () => {
    expect(() => diffMonths('2026-13', '2026-01')).toThrow(RangeError);
    expect(() => diffMonths('2026-01-01', '2026-01')).toThrow(RangeError);
  });
});
