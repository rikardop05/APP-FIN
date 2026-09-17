import { describe, expect, it } from 'vitest';

import { extractPdfTextItems } from '@/lib/import/pdf/extract';
import { parseNubankPdf } from '@/lib/import/pdf/nubank';
import { groupIntoRows, type PdfTextRow } from '@/lib/import/pdf/rows';
import { buildPositionedPdfPages } from '@/lib/import/pdf/__fixtures__/synthetic-pdf';

/**
 * Geometria MEDIDA da fatura Nubank (docs/IMPORT-SOURCES.md §6). A fixture
 * reproduz as mesmas x: data 123, cartao 172, descricao 185 ou 214, valor
 * alinhado a direita a partir de ~491.
 */
const DATE_X = 123;
const CARD_X = 172;
const DESC_X = 185;
const DESC_WITH_CARD_X = 214;
const VALUE_RIGHT = 508;

/** Valor alinhado a direita: quanto maior o texto, menor o x inicial. */
function valueX(text: string): number {
  return VALUE_RIGHT - Math.max(0, text.length - 7) * 4;
}

interface Run {
  x: number;
  y: number;
  text: string;
}

function makeRow(y: number, runs: Run[], page = 1): PdfTextRow {
  return {
    page,
    y,
    cells: runs.map((run) => ({ x: run.x, text: run.text })),
    text: runs
      .map((run) => run.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  };
}

interface TransactionShape {
  date: string;
  description: string;
  value: string;
  card?: string;
}

function transactionRuns(y: number, tx: TransactionShape): Run[] {
  const runs: Run[] = [{ x: DATE_X, y, text: tx.date }];
  if (tx.card !== undefined) runs.push({ x: CARD_X, y, text: tx.card });
  runs.push({
    x: tx.card === undefined ? DESC_X : DESC_WITH_CARD_X,
    y,
    text: tx.description,
  });
  runs.push({ x: valueX(tx.value), y, text: tx.value });
  return runs;
}

function transactionRow(y: number, tx: TransactionShape): PdfTextRow {
  return makeRow(y, transactionRuns(y, tx));
}

/** Cabecalho medido, repetido em toda pagina (§6.2). */
function headerRuns(): Run[] {
  return [
    { x: DESC_X, y: 795, text: 'TITULAR ANONIMIZADO' },
    { x: 327, y: 782, text: 'Fatura 15 SET 2026' },
    { x: 442, y: 782, text: 'Emissão e envio 15 SET 2026' },
  ];
}

function pageNumberRun(): Run {
  return { x: 290, y: 21, text: '1 de 2' };
}

describe('parseNubankPdf — as quatro armadilhas da fatura real (§6.1)', () => {
  it('armadilha 1: le descricao em 185 e em 214 (coluna de cartao opcional)', () => {
    const semCartao = transactionRow(700, {
      date: '05 SET',
      description: 'PADARIA ANONIMA',
      value: 'R$ 20,00',
    });
    const comCartao = transactionRow(680, {
      date: '10 SET',
      description: 'MERCADO ANONIMO',
      card: '•••• 9999',
      value: 'R$ 150,00',
    });

    const result = parseNubankPdf([
      makeRow(782, [{ x: 327, y: 782, text: 'Fatura 15 SET 2026' }]),
      semCartao,
      comCartao,
    ]);

    expect(result.rows.map((row) => row.rawDescription)).toEqual([
      'PADARIA ANONIMA',
      'MERCADO ANONIMO',
    ]);
    // A coluna de cartao nao entra na descricao.
    expect(result.rows[1]?.rawDescription).not.toContain('9999');
  });

  it('armadilha 2: aceita valor em x diferente (alinhado a direita), por faixa', () => {
    const curto = transactionRow(700, {
      date: '05 SET',
      description: 'PADARIA',
      value: 'R$ 9,99',
    });
    const longo = transactionRow(680, {
      date: '06 SET',
      description: 'MERCADO',
      value: 'R$ 999,99',
    });

    const result = parseNubankPdf([
      makeRow(782, [{ x: 327, y: 782, text: 'Fatura 15 SET 2026' }]),
      curto,
      longo,
    ]);

    expect(result.rows[0]?.amountCents).toBe(-999);
    expect(result.rows[1]?.amountCents).toBe(-99999);
  });

  it('armadilha 3: anexa linha de continuacao sem data a transacao de cima', () => {
    const result = parseNubankPdf([
      makeRow(782, [{ x: 327, y: 782, text: 'Fatura 15 SET 2026' }]),
      transactionRow(700, {
        date: '05 SET',
        description: 'COMPRA INTERNACIONAL',
        value: 'R$ 100,00',
      }),
      makeRow(684, [{ x: DESC_WITH_CARD_X, y: 684, text: 'CAMBIO 1.00 = 5.50' }]),
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.rawDescription).toBe(
      'COMPRA INTERNACIONAL CAMBIO 1.00 = 5.50',
    );
  });

  it('armadilha 4: parcela embutida no fim da descricao via detectInstallment', () => {
    const result = parseNubankPdf([
      makeRow(782, [{ x: 327, y: 782, text: 'Fatura 15 SET 2026' }]),
      transactionRow(700, {
        date: '12 SET',
        description: 'AMAZON - PARCELA 03/10',
        value: 'R$ 250,00',
      }),
    ]);

    expect(result.rows[0]?.installment).toEqual({ current: 3, total: 10 });
    expect(result.rows[0]?.rawDescription).toBe('AMAZON - PARCELA 03/10');
  });
});

describe('parseNubankPdf — limites da continuacao (§6.1/§6.3)', () => {
  it('nao anexa linha sem data abaixo do rodape (y<=120)', () => {
    const result = parseNubankPdf([
      makeRow(782, [{ x: 327, y: 782, text: 'Fatura 15 SET 2026' }]),
      transactionRow(700, { date: '05 SET', description: 'MERCADO', value: 'R$ 20,00' }),
      makeRow(100, [
        { x: DESC_WITH_CARD_X, y: 100, text: 'Nubank S.A. Central de atendimento' },
      ]),
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.rawDescription).toBe('MERCADO');
  });

  it('nao anexa linha sem data em x=185 (nao e ancora de continuacao)', () => {
    const result = parseNubankPdf([
      makeRow(782, [{ x: 327, y: 782, text: 'Fatura 15 SET 2026' }]),
      transactionRow(700, { date: '05 SET', description: 'MERCADO', value: 'R$ 20,00' }),
      makeRow(684, [{ x: DESC_X, y: 684, text: 'texto solto de rodape' }]),
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.rawDescription).toBe('MERCADO');
  });

  it('nao anexa continuacao de outra pagina', () => {
    const result = parseNubankPdf([
      makeRow(782, [{ x: 327, y: 782, text: 'Fatura 15 SET 2026' }]),
      transactionRow(700, { date: '05 SET', description: 'COMPRA', value: 'R$ 20,00' }),
      makeRow(684, [{ x: DESC_WITH_CARD_X, y: 684, text: 'CAMBIO 1.00 = 5.50' }], 2),
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.rawDescription).toBe('COMPRA');
  });

  it('continuacao com "fatura" e 20xx nao define o ano', () => {
    const result = parseNubankPdf(
      [
        transactionRow(700, { date: '22 DEZ', description: 'MERCADO', value: 'R$ 5,00' }),
        makeRow(684, [{ x: DESC_WITH_CARD_X, y: 684, text: 'CAMBIO ref fatura 2025' }]),
      ],
      { defaultYear: 2024 },
    );

    expect(result.rows[0]?.occurredOn).toBe('2024-12-22');
  });
});

describe('parseNubankPdf — resolucao do ano (§6.2)', () => {
  it('le o ano do cabecalho, repetido em todas as paginas', () => {
    const result = parseNubankPdf([
      makeRow(782, [{ x: 327, y: 782, text: 'Fatura 15 SET 2026' }]),
      transactionRow(700, { date: '22 AGO', description: 'PADARIA', value: 'R$ 5,00' }),
    ]);
    expect(result.rows[0]?.occurredOn).toBe('2026-08-22');
  });

  it('usa o ano da competencia informada pelo chamador quando o cabecalho nao tem', () => {
    const result = parseNubankPdf(
      [transactionRow(700, { date: '22 DEZ', description: 'PADARIA', value: 'R$ 5,00' })],
      { defaultYear: 2025 },
    );
    expect(result.rows[0]?.occurredOn).toBe('2025-12-22');
  });

  it('sem ano no cabecalho nem parametro, ocorreuOn volta null e a linha nao e engolida', () => {
    const result = parseNubankPdf([
      transactionRow(700, { date: '22 AGO', description: 'PADARIA', value: 'R$ 15,00' }),
      transactionRow(680, { date: '23/08/2026', description: 'MERCADO', value: 'R$ 20,00' }),
    ]);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.occurredOn).toBeNull();
    expect(result.rows[0]?.amountCents).toBe(-1500);
    expect(result.rows[0]?.rawDescription).toBe('PADARIA');
    expect(result.rows[1]?.occurredOn).toBe('2026-08-23');
    expect(result.diagnostics).toEqual([]);
  });
});

describe('parseNubankPdf — bordas', () => {
  it('devolve resultado vazio para lista de linhas vazia', () => {
    expect(parseNubankPdf([])).toEqual({
      rows: [],
      diagnostics: [],
      reportedTotalCents: null,
    });
  });

  it('data inexistente no calendario volta com occurredOn null, sem abortar', () => {
    const result = parseNubankPdf([
      makeRow(782, [{ x: 327, y: 782, text: 'Fatura 15 SET 2026' }]),
      transactionRow(700, { date: '31 FEV', description: 'PADARIA', value: 'R$ 5,00' }),
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.occurredOn).toBeNull();
    expect(result.rows[0]?.amountCents).toBe(-500);
    expect(result.diagnostics).toEqual([]);
  });

  it('linha com data e sem valor volta com amountCents null e o resto do arquivo e lido', () => {
    const semValor = makeRow(700, [
      { x: DATE_X, y: 700, text: '22 AGO' },
      { x: DESC_X, y: 700, text: 'PADARIA' },
    ]);
    const result = parseNubankPdf([
      makeRow(782, [{ x: 327, y: 782, text: 'Fatura 15 SET 2026' }]),
      semValor,
      transactionRow(680, { date: '23 AGO', description: 'MERCADO', value: 'R$ 20,00' }),
    ]);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.amountCents).toBeNull();
    expect(result.rows[0]?.rawDescription).toBe('PADARIA');
    expect(result.rows[1]?.amountCents).toBe(-2000);
    expect(result.diagnostics).toEqual([]);
  });

  it('nao transforma cabecalho, rodape nem propaganda em lancamento', () => {
    const result = parseNubankPdf([
      ...headerRuns().map((run) => makeRow(run.y, [run])),
      makeRow(438, [{ x: DESC_X, y: 438, text: 'Data de vencimento: 15 SET 2026' }]),
      makeRow(415, [{ x: DESC_X, y: 415, text: 'Período vigente: 15 AGO a 15 SET' }]),
      makeRow(732, [{ x: DESC_X, y: 732, text: 'TRANSAÇÕES' }]),
      makeRow(21, [pageNumberRun()]),
    ]);

    expect(result.rows).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.reportedTotalCents).toBeNull();
  });

  it('le o total impresso no mesmo sinal do sistema', () => {
    const result = parseNubankPdf([
      makeRow(782, [{ x: 327, y: 782, text: 'Fatura 15 SET 2026' }]),
      transactionRow(700, { date: '22 AGO', description: 'PADARIA', value: 'R$ 20,00' }),
      makeRow(600, [
        { x: DESC_X, y: 600, text: 'Total a pagar' },
        { x: valueX('R$ 20,00'), y: 600, text: 'R$ 20,00' },
      ]),
    ]);

    expect(result.reportedTotalCents).toBe(-2000);
  });
});

describe('parseNubankPdf — ponta a ponta sobre fixture com a geometria medida', () => {
  function statementPages(): Run[][] {
    const pageOne: Run[] = [
      ...headerRuns(),
      { x: DESC_X, y: 438, text: 'Data de vencimento: 15 SET 2026' },
      { x: DESC_X, y: 415, text: 'Período vigente: 15 AGO a 15 SET' },
      pageNumberRun(),
    ];
    const pageTwo: Run[] = [
      ...headerRuns(),
      { x: DESC_X, y: 732, text: 'TRANSAÇÕES' },
      { x: 300, y: 732, text: 'COMPRAS E PAGAMENTOS' },
      ...transactionRuns(700, { date: '05 SET', description: 'PADARIA ANONIMA', value: 'R$ 20,00' }),
      { x: DESC_WITH_CARD_X, y: 684, text: 'CAMBIO 1.00 = 5.50' },
      ...transactionRuns(660, {
        date: '10 SET',
        description: 'MERCADO ANONIMO',
        card: '•••• 9999',
        value: 'R$ 150,00',
      }),
      ...transactionRuns(640, {
        date: '12 SET',
        description: 'AMAZON - PARCELA 03/10',
        value: 'R$ 250,00',
      }),
      ...transactionRuns(620, { date: '14 SET', description: 'ESTORNO ANONIMO', value: '-R$ 50,00' }),
      { x: DESC_X, y: 560, text: 'Total a pagar' },
      { x: valueX('R$ 370,00'), y: 560, text: 'R$ 370,00' },
      { x: 290, y: 21, text: '2 de 2' },
    ];
    return [pageOne, pageTwo];
  }

  it('extract -> groupIntoRows -> parseNubankPdf: soma = total, sem engolir linha', async () => {
    const items = await extractPdfTextItems(
      buildPositionedPdfPages(statementPages()),
    );
    const result = parseNubankPdf(groupIntoRows(items));

    expect(result.diagnostics).toEqual([]);
    expect(result.rows).toHaveLength(4);

    // A continuacao nao virou lancamento e foi anexada a transacao de cima.
    expect(result.rows[0]?.rawDescription).toBe(
      'PADARIA ANONIMA CAMBIO 1.00 = 5.50',
    );
    expect(result.rows[1]?.rawDescription).toBe('MERCADO ANONIMO');
    expect(result.rows[2]?.installment).toEqual({ current: 3, total: 10 });
    expect(result.rows[3]?.amountCents).toBe(5000);

    // O ano veio do cabecalho repetido na pagina 2.
    expect(result.rows.map((row) => row.occurredOn)).toEqual([
      '2026-09-05',
      '2026-09-10',
      '2026-09-12',
      '2026-09-14',
    ]);

    const sum = result.rows.reduce((acc, row) => acc + (row.amountCents ?? 0), 0);
    expect(sum).toBe(result.reportedTotalCents);
    expect(result.reportedTotalCents).toBe(-37000);
  });
});
