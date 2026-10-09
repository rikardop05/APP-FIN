import { describe, expect, it } from 'vitest';

import { listContentState, sortForDisplay } from './list-presentation';

/**
 * O bug do T-403: carga falha -> `rows` fica vazio -> a tela mostrava o estado
 * vazio "Nenhum lancamento ainda" abaixo do erro, dizendo que nao ha nada
 * quando na verdade nao carregou.
 */
describe('listContentState', () => {
  it('carregando vence tudo (inclusive recarga apos erro)', () => {
    expect(listContentState({ loading: true, failed: false, rowCount: 0 })).toBe('loading');
    expect(listContentState({ loading: true, failed: true, rowCount: 0 })).toBe('loading');
    expect(listContentState({ loading: true, failed: true, rowCount: 9 })).toBe('loading');
  });

  it('erro de carga NUNCA vira estado vazio', () => {
    expect(listContentState({ loading: false, failed: true, rowCount: 0 })).toBe('error');
  });

  it('erro tambem suprime a lista (so o alerta)', () => {
    expect(listContentState({ loading: false, failed: true, rowCount: 7 })).toBe('error');
  });

  it('vazio so com carga bem-sucedida e zero itens', () => {
    expect(listContentState({ loading: false, failed: false, rowCount: 0 })).toBe('empty');
  });

  it('lista quando a carga deu certo e ha itens', () => {
    expect(listContentState({ loading: false, failed: false, rowCount: 1 })).toBe('list');
    expect(listContentState({ loading: false, failed: false, rowCount: 60 })).toBe('list');
  });
});

describe('sortForDisplay: o mês atual primeiro, parcelas futuras no fim', () => {
  const row = (id: string, competence: string, occurredOn: string) => ({ id, competence, occurredOn });
  const TODAY = '2026-10-08';

  it('ordem: mês atual (mais recente primeiro), meses passados (do mais recente), futuros por último (do mais próximo)', () => {
    const rows = [
      row('futuro-dez', '2026-12', '2026-12-01'),
      row('passado-set', '2026-09', '2026-09-15'),
      row('atual-01', '2026-10', '2026-10-01'),
      row('futuro-nov', '2026-11', '2026-11-01'),
      row('atual-07', '2026-10', '2026-10-07'),
      row('passado-ago', '2026-08', '2026-08-30'),
    ];
    expect(sortForDisplay(rows, TODAY).map((r) => r.id)).toEqual([
      'atual-07',
      'atual-01',
      'passado-set',
      'passado-ago',
      'futuro-nov',
      'futuro-dez',
    ]);
  });

  it('o critério é a COMPETÊNCIA (o eixo do app), não a data da compra: parcela de nov comprada em set é futura', () => {
    const rows = [row('parcela', '2026-11', '2026-09-20'), row('compra-de-hoje', '2026-10', '2026-10-08')];
    expect(sortForDisplay(rows, TODAY).map((r) => r.id)).toEqual(['compra-de-hoje', 'parcela']);
  });

  it('empate preserva a ordem recebida do servidor (ordenação estável)', () => {
    const rows = [row('a', '2026-10', '2026-10-05'), row('b', '2026-10', '2026-10-05'), row('c', '2026-10', '2026-10-05')];
    expect(sortForDisplay(rows, TODAY).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('não altera o array de entrada; lista vazia devolve vazia', () => {
    const rows = [row('futuro', '2026-12', '2026-12-01'), row('atual', '2026-10', '2026-10-01')];
    sortForDisplay(rows, TODAY);
    expect(rows.map((r) => r.id)).toEqual(['futuro', 'atual']);
    expect(sortForDisplay([], TODAY)).toEqual([]);
  });

  it('só futuro ou só passado: mantém a lógica (passado do mais recente; futuro do mais próximo)', () => {
    expect(sortForDisplay([row('a', '2026-01', '2026-01-10'), row('b', '2026-05', '2026-05-10')], TODAY).map((r) => r.id)).toEqual(['b', 'a']);
    expect(sortForDisplay([row('a', '2027-02', '2027-02-10'), row('b', '2026-12', '2026-12-10')], TODAY).map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('installmentLabel', () => {
  it('com total vira 03/10', async () => {
    const { installmentLabel } = await import('./list-presentation');
    expect(installmentLabel(3, 10)).toEqual({ total: 10, text: '03/10' });
  });
  it('sem total ou fora do plano cai para texto simples', async () => {
    const { installmentLabel } = await import('./list-presentation');
    expect(installmentLabel(3, null)).toEqual({ total: null, text: 'parcela 03' });
    expect(installmentLabel(11, 10)).toEqual({ total: null, text: 'parcela 11' });
  });
});

import { stripInstallmentSuffix } from './list-presentation';

describe('stripInstallmentSuffix: a parcela não aparece duas vezes', () => {
  it('tira o sufixo que bate com a parcela da linha', () => {
    expect(stripInstallmentSuffix('LOJA SINTETICA (03/10)', 3, 10)).toBe('LOJA SINTETICA');
    expect(stripInstallmentSuffix('LOJA SINTETICA 03/10', 3, 10)).toBe('LOJA SINTETICA');
    expect(stripInstallmentSuffix('LOJA SINTETICA PARC 3/10', 3, 10)).toBe('LOJA SINTETICA');
    expect(stripInstallmentSuffix('LOJA SINTETICA PARCELA 3 DE 10', 3, 10)).toBe('LOJA SINTETICA');
  });

  it('não mexe no que não bate, nem sem total, nem se sobraria vazio', () => {
    expect(stripInstallmentSuffix('LOJA (04/10)', 3, 10)).toBe('LOJA (04/10)');
    expect(stripInstallmentSuffix('LOJA (03/10)', 3, null)).toBe('LOJA (03/10)');
    expect(stripInstallmentSuffix('03/10', 3, 10)).toBe('03/10');
    expect(stripInstallmentSuffix('MERCADO 12/2026', 3, 10)).toBe('MERCADO 12/2026');
  });
});

import { groupByCompetence } from './list-presentation';

describe('groupByCompetence: agrupamento por mês com total', () => {
  it('mantém a ordem e soma cada mês só com receita e despesa (a regra da Sobra)', () => {
    const rows = [
      { competence: '2026-10', amountCents: -1000, kind: 'expense' },
      { competence: '2026-10', amountCents: 5000, kind: 'income' },
      { competence: '2026-10', amountCents: -9999, kind: 'credit_card_payment' },
      { competence: '2026-09', amountCents: -200, kind: 'expense' },
      { competence: '2026-11', amountCents: -300, kind: 'expense' },
    ];
    const groups = groupByCompetence(rows);
    expect(groups.map((g) => [g.competence, g.rows.length, g.totalCents])).toEqual([
      ['2026-10', 3, 4000],
      ['2026-09', 1, -200],
      ['2026-11', 1, -300],
    ]);
  });

  it('lista vazia, nenhum grupo', () => {
    expect(groupByCompetence([])).toEqual([]);
  });
});
