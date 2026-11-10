import { describe, expect, it } from 'vitest';

import {
  ALL_MONTHS,
  competenceParam,
  countLabel,
  initialView,
  reviewLabel,
  shiftMonth,
  surplusLabel,
  toggleAllMonths,
  viewHref,
} from './month-view';

const TODAY = '2026-11-10';

describe('initialView: o que a URL pede ao abrir /lancamentos', () => {
  it('sem parâmetro abre o mês corrente', () => {
    expect(initialView({}, TODAY)).toEqual({ month: '2026-11', uncategorized: false });
  });

  it('?mes=AAAA-MM abre aquele mês; ?mes=todos abre todos', () => {
    expect(initialView({ mes: '2026-09' }, TODAY)).toEqual({ month: '2026-09', uncategorized: false });
    expect(initialView({ mes: 'todos' }, TODAY)).toEqual({ month: ALL_MONTHS, uncategorized: false });
  });

  it('mes inválido cai no mês corrente, sem quebrar', () => {
    for (const mes of ['2026-13', '2026-1', 'novembro', '', '2026-11-10']) {
      expect(initialView({ mes }, TODAY).month).toBe('2026-11');
    }
  });

  it('?semCategoria=1 (deep link do Painel) abre em TODOS os meses, já filtrado', () => {
    expect(initialView({ semCategoria: '1' }, TODAY)).toEqual({ month: ALL_MONTHS, uncategorized: true });
    // Um mês explícito junto vence.
    expect(initialView({ semCategoria: '1', mes: '2026-10' }, TODAY)).toEqual({ month: '2026-10', uncategorized: true });
    expect(initialView({ semCategoria: '0' }, TODAY).uncategorized).toBe(false);
  });

  it('?aplicarRegras=1 e ?ids= não mudam o mês', () => {
    expect(initialView({ aplicarRegras: '1' }, TODAY)).toEqual({ month: '2026-11', uncategorized: false });
    expect(initialView({ ids: 'a,b' }, TODAY)).toEqual({ month: '2026-11', uncategorized: false });
  });

  it('parâmetro repetido usa o primeiro', () => {
    expect(initialView({ mes: ['2026-08', '2026-09'] }, TODAY).month).toBe('2026-08');
  });
});

describe('viewHref: a URL acompanha o mês', () => {
  it('mês corrente é o padrão e não leva parâmetro', () => {
    expect(viewHref('2026-11', TODAY)).toBe('/lancamentos');
  });
  it('outro mês e todos os meses vão em ?mes=', () => {
    expect(viewHref('2026-10', TODAY)).toBe('/lancamentos?mes=2026-10');
    expect(viewHref(ALL_MONTHS, TODAY)).toBe('/lancamentos?mes=todos');
  });
  it('com o deep link de não categorizados ativo, ele continua na URL', () => {
    expect(viewHref(ALL_MONTHS, TODAY, { uncategorized: true })).toBe('/lancamentos?semCategoria=1');
    expect(viewHref('2026-10', TODAY, { uncategorized: true })).toBe('/lancamentos?semCategoria=1&mes=2026-10');
  });
  it('ida e volta: o que viewHref escreve, initialView lê de volta', () => {
    const cases = [
      { month: '2026-11', uncategorized: false },
      { month: '2026-03', uncategorized: false },
      { month: ALL_MONTHS, uncategorized: false },
      { month: ALL_MONTHS, uncategorized: true },
      { month: '2026-03', uncategorized: true },
      // Único caso que precisa do `mes` explícito para não virar "todos": o corrente com o deep link.
      { month: '2026-11', uncategorized: true },
    ];
    for (const view of cases) {
      const href = viewHref(view.month, TODAY, { uncategorized: view.uncategorized });
      const params = Object.fromEntries(new URLSearchParams(href.split('?')[1] ?? ''));
      expect(initialView(params, TODAY), href).toEqual(view);
    }
  });
});

describe('navegação de mês', () => {
  it('‹ e › andam um mês, inclusive na virada do ano', () => {
    expect(shiftMonth('2026-11', -1)).toBe('2026-10');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
  });
  it('em "todos os meses" não há de onde andar', () => {
    expect(shiftMonth(ALL_MONTHS, 1)).toBe(ALL_MONTHS);
  });
  it('"Todos os meses" alterna com o mês corrente', () => {
    expect(toggleAllMonths('2026-09', TODAY)).toBe(ALL_MONTHS);
    expect(toggleAllMonths(ALL_MONTHS, TODAY)).toBe('2026-11');
  });
  it('a consulta só leva competência com um mês escolhido', () => {
    expect(competenceParam('2026-09')).toBe('2026-09');
    expect(competenceParam(ALL_MONTHS)).toBeUndefined();
  });
});

describe('textos', () => {
  it('Sobra vira Déficit quando negativa', () => {
    expect(surplusLabel(100)).toBe('Sobra');
    expect(surplusLabel(0)).toBe('Sobra');
    expect(surplusLabel(-1)).toBe('Déficit');
  });
  it('contagem no singular e no plural', () => {
    expect(countLabel(1)).toBe('1 lançamento');
    expect(countLabel(73)).toBe('73 lançamentos');
    expect(countLabel(0)).toBe('0 lançamentos');
  });
  it('o botão Revisar só existe com pendência e leva a contagem', () => {
    expect(reviewLabel(0)).toBeNull();
    expect(reviewLabel(-1)).toBeNull();
    expect(reviewLabel(1)).toBe('Revisar 1 sem categoria');
    expect(reviewLabel(6)).toBe('Revisar 6 sem categoria');
  });
});
