import { describe, expect, it } from 'vitest';
import type { Cents } from '@/lib/money';
import { changedCount, outsideLine, saveHint, totalLine, unbudgetedLine, upcomingLine } from './totals';

const c = (n: number) => n as Cents;
/** O formatBRL pode usar espaço não separável depois de `R$`; o teste compara com espaço comum. */
const plain = (text: string | null) => (text === null ? null : text.replace(/ /g, ' '));

describe('textos do total do mês', () => {
  it('com orçamento: esperado de orçado', () => {
    expect(plain(totalLine({ expectedCents: c(80000), plannedCents: c(200000) }))).toBe(
      'R$ 800,00 de R$ 2.000,00 orçados',
    );
  });
  it('previsto só aparece quando existe', () => {
    expect(upcomingLine(c(0))).toBeNull();
    expect(plain(upcomingLine(c(30000)))).toBe('Mais R$ 300,00 previstos até o fim do mês.');
  });
  it('gasto fora do orçamento: some quando é zero e abre em realizado e previsto quando há previsão', () => {
    expect(unbudgetedLine({ spentCents: c(0), upcomingCents: c(0), expectedCents: c(0) })).toBeNull();
    expect(plain(unbudgetedLine({ spentCents: c(90000), upcomingCents: c(0), expectedCents: c(90000) }))).toBe(
      'Mais R$ 900,00 em categorias sem orçamento, fora desta barra.',
    );
    expect(plain(unbudgetedLine({ spentCents: c(90000), upcomingCents: c(10000), expectedCents: c(100000) }))).toBe(
      'Mais R$ 1.000,00 em categorias sem orçamento (R$ 900,00 realizados e R$ 100,00 previstos), fora desta barra.',
    );
  });
});

describe('outsideLine', () => {
  it('some sem valor e diz quanto ficou fora das categorias', () => {
    expect(outsideLine({ expectedCents: c(0) })).toBeNull();
    expect(plain(outsideLine({ expectedCents: c(80000) }))).toBe(
      'Fora desta conta: R$ 800,00 em despesas sem categoria ou em categoria que não recebe orçamento.',
    );
  });
});

describe('saveHint e changedCount', () => {
  it('diz que nada mudou', () => {
    expect(saveHint(0)).toBe('Nada mudou desde o último salvamento');
    expect(saveHint(1)).toBe('1 categoria alterada, ainda não salva');
    expect(saveHint(3)).toBe('3 categorias alteradas, ainda não salvas');
  });
  it('conta categorias diferentes do salvo', () => {
    expect(changedCount({ a: '1', b: '2' }, { a: '1', b: '3' })).toBe(1);
    expect(changedCount({ a: '1' }, { a: '1', b: '' })).toBe(0);
    expect(changedCount({ a: '' }, {})).toBe(0);
    expect(changedCount({ a: '5' }, {})).toBe(1);
  });
});
