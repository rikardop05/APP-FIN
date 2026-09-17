import { describe, expect, it } from 'vitest';

import { PdfPasswordError, extractPdfTextItems } from '@/lib/import/pdf/extract';
import { groupIntoRows, type PdfTextRow } from '@/lib/import/pdf/rows';
import {
  SANTANDER_X_BANDS,
  parseSantanderPdf,
} from '@/lib/import/pdf/santander';
import {
  buildEncryptedPdf,
  buildPositionedPdf,
} from '@/lib/import/pdf/__fixtures__/synthetic-pdf';

/**
 * Geometria MEDIDA da fatura Santander (docs/IMPORT-SOURCES.md §8): data e
 * descricao fundidas em `x=33`, data auxiliar opcional em `x=168`, valor sem
 * `R$` em `x≈201-214` (alinhado a direita), marcador solto em `x=16-17`, e o
 * quadro-resumo em `x>320`.
 */
const MARKER_X = 16;
const DATE_X = 33;
const AUX_X = 168;
const VALUE_RIGHT = 214;

/** Valor alinhado a direita: quanto maior o texto, menor o x inicial. */
function valueX(text: string): number {
  return Math.max(201, VALUE_RIGHT - Math.max(0, text.length - 6) * 3);
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
  auxDate?: string;
  marker?: boolean;
}

function transactionRuns(y: number, tx: TransactionShape): Run[] {
  const runs: Run[] = [];
  if (tx.marker !== false) runs.push({ x: MARKER_X, y, text: '9' });
  runs.push({ x: DATE_X, y, text: `${tx.date} ${tx.description}`.trim() });
  if (tx.auxDate !== undefined) runs.push({ x: AUX_X, y, text: tx.auxDate });
  runs.push({ x: valueX(tx.value), y, text: tx.value });
  return runs;
}

function transactionRow(y: number, tx: TransactionShape): PdfTextRow {
  return makeRow(y, transactionRuns(y, tx));
}

describe('parseSantanderPdf — o run fundido dd/MM + descricao (§8)', () => {
  it('separa data e descricao do mesmo run', () => {
    const result = parseSantanderPdf(
      [
        transactionRow(700, {
          date: '22/08',
          description: 'SUPERMERCADO ANONIMO',
          auxDate: '22/08',
          value: '154,32',
        }),
      ],
      { defaultYear: 2026 },
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.occurredOn).toBe('2026-08-22');
    expect(result.rows[0]?.rawDescription).toBe('SUPERMERCADO ANONIMO');
    expect(result.rows[0]?.amountCents).toBe(-15432);
  });

  it('nao deixa o marcador (x=16) nem a data auxiliar (x=168) entrarem na descricao', () => {
    const result = parseSantanderPdf(
      [
        transactionRow(700, {
          date: '23/08',
          description: 'FARMACIA ANONIMA',
          auxDate: '20/08',
          value: '45,00',
        }),
      ],
      { defaultYear: 2026 },
    );

    expect(result.rows[0]?.rawDescription).toBe('FARMACIA ANONIMA');
    expect(result.rows[0]?.rawDescription).not.toContain('20/08');
    expect(result.rows[0]?.rawDescription).not.toContain('9');
  });

  it('le valor sem R$, com sinal negativo por -', () => {
    const result = parseSantanderPdf(
      [
        transactionRow(700, {
          date: '24/08',
          description: 'PAGAMENTO RECEBIDO',
          value: '-9.999,99',
        }),
        transactionRow(680, {
          date: '25/08',
          description: 'PADARIA ANONIMA',
          value: '9,90',
        }),
      ],
      { defaultYear: 2026 },
    );

    expect(result.rows[0]?.amountCents).toBe(999999);
    expect(result.rows[1]?.amountCents).toBe(-990);
  });

  it('reconhece parcela via detectInstallment (T-121)', () => {
    const result = parseSantanderPdf(
      [
        transactionRow(700, {
          date: '23/08',
          description: 'MAGAZINE ANONIMA PARCELA 03/10',
          value: '250,00',
        }),
      ],
      { defaultYear: 2026 },
    );

    expect(result.rows[0]?.installment).toEqual({ current: 3, total: 10 });
    expect(result.rows[0]?.rawDescription).toBe(
      'MAGAZINE ANONIMA PARCELA 03/10',
    );
  });

  it('captura valor alinhado a direita que comeca antes da faixa medida', () => {
    const result = parseSantanderPdf(
      [
        makeRow(700, [
          { x: DATE_X, y: 700, text: '22/08 LOJA ANONIMA' },
          { x: 180, y: 700, text: '-9.999.999,99' },
        ]),
      ],
      { defaultYear: 2026 },
    );

    expect(result.rows[0]?.amountCents).toBe(999999999);
  });
});

describe('parseSantanderPdf — as duas tabelas na mesma y (§8)', () => {
  const comResumo: PdfTextRow[] = [
    transactionRow(700, {
      date: '22/08',
      description: 'SUPERMERCADO ANONIMO',
      value: '154,32',
    }),
    // quadro-resumo na MESMA y=700, x>320
    makeRow(700, [
      { x: 340, y: 700, text: '(-) LIMITE DISPONIVEL' },
      { x: 500, y: 700, text: '1.000,00' },
    ]),
  ];

  it('linha do quadro-resumo nao vira lancamento', () => {
    const result = parseSantanderPdf(comResumo, { defaultYear: 2026 });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.rawDescription).toBe('SUPERMERCADO ANONIMO');
  });

  it('linha contaminada (agrupada sem xBands) nao inventa lancamento nem perde o real', () => {
    // Sem xBands, as celulas das duas tabelas caem na mesma PdfTextRow.
    const contaminada = makeRow(700, [
      { x: DATE_X, y: 700, text: '22/08 SUPERMERCADO ANONIMO' },
      { x: valueX('154,32'), y: 700, text: '154,32' },
      { x: 340, y: 700, text: '(-) LIMITE DISPONIVEL' },
      { x: 500, y: 700, text: '1.000,00' },
    ]);

    const result = parseSantanderPdf([contaminada], { defaultYear: 2026 });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.rawDescription).toBe('SUPERMERCADO ANONIMO');
    expect(result.rows[0]?.amountCents).toBe(-15432);
  });
});

describe('parseSantanderPdf — ano vem do parametro, nunca do relogio', () => {
  it('usa defaultYear quando informado', () => {
    const result = parseSantanderPdf(
      [transactionRow(700, { date: '22/08', description: 'PADARIA', value: '5,00' })],
      { defaultYear: 2025 },
    );
    expect(result.rows[0]?.occurredOn).toBe('2025-08-22');
  });

  it('le o ano da data completa do quadro-resumo (x>250) antes do parametro', () => {
    const result = parseSantanderPdf(
      [
        makeRow(750, [{ x: 401, y: 750, text: '22/08/2026' }]),
        transactionRow(700, { date: '22/08', description: 'PADARIA', value: '5,00' }),
      ],
      { defaultYear: 1999 },
    );
    expect(result.rows[0]?.occurredOn).toBe('2026-08-22');
  });

  it('nao usa um dd/MM/aaaa da area de lancamentos como ano do documento', () => {
    const result = parseSantanderPdf(
      [
        makeRow(700, [{ x: DATE_X, y: 700, text: '22/08/2026 ALGO' }]),
        transactionRow(680, { date: '23/08', description: 'PADARIA', value: '5,00' }),
      ],
      { defaultYear: 2025 },
    );
    expect(result.rows[0]?.occurredOn).toBe('2025-08-23');
  });

  it('sem defaultYear, occurredOn volta null e a linha nao e engolida', () => {
    const result = parseSantanderPdf([
      transactionRow(700, { date: '22/08', description: 'PADARIA', value: '5,00' }),
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.occurredOn).toBeNull();
    expect(result.rows[0]?.amountCents).toBe(-500);
  });

  it('data inexistente no calendario volta com occurredOn null', () => {
    const result = parseSantanderPdf(
      [transactionRow(700, { date: '31/02', description: 'PADARIA', value: '5,00' })],
      { defaultYear: 2026 },
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.occurredOn).toBeNull();
  });
});

describe('parseSantanderPdf — bordas', () => {
  it('devolve resultado vazio para lista de linhas vazia', () => {
    expect(parseSantanderPdf([])).toEqual({
      rows: [],
      diagnostics: [],
      reportedTotalCents: null,
    });
  });

  it('linha com data e sem valor volta com amountCents null', () => {
    const semValor = makeRow(700, [{ x: DATE_X, y: 700, text: '22/08 PADARIA' }]);
    const result = parseSantanderPdf([semValor], { defaultYear: 2026 });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.amountCents).toBeNull();
    expect(result.rows[0]?.rawDescription).toBe('PADARIA');
  });

  it('ignora cabecalho, propaganda e data completa (nao e lancamento)', () => {
    const result = parseSantanderPdf(
      [
        makeRow(800, [{ x: DATE_X, y: 800, text: 'SANTANDER ANONIMIZADO' }]),
        makeRow(780, [{ x: DATE_X, y: 780, text: 'Vencimento: 22/08/2026' }]),
        makeRow(60, [{ x: DATE_X, y: 60, text: 'Parcele sua fatura no app' }]),
      ],
      { defaultYear: 2026 },
    );

    expect(result.rows).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.reportedTotalCents).toBeNull();
  });

  it('le o total impresso do resumo (=) no mesmo sinal do sistema', () => {
    const result = parseSantanderPdf(
      [
        transactionRow(700, { date: '22/08', description: 'PADARIA', value: '20,00' }),
        makeRow(600, [
          { x: 340, y: 600, text: '(=) VALOR TOTAL DA FATURA' },
          { x: 500, y: 600, text: '20,00' },
        ]),
      ],
      { defaultYear: 2026 },
    );

    expect(result.reportedTotalCents).toBe(-2000);
  });
});

describe('parseSantanderPdf — ponta a ponta sobre fixture com a geometria medida', () => {
  interface StatementTransaction {
    date: string;
    description: string;
    value: string;
  }

  function statementPdf(
    transactions: StatementTransaction[],
    total: string,
  ): Uint8Array {
    const runs: Run[] = [
      { x: DATE_X, y: 800, text: 'SANTANDER ANONIMIZADO' },
      { x: DATE_X, y: 780, text: 'Vencimento: 22/08/2026' },
      // data completa no quadro-resumo (§8.2): fonte do ano do documento
      { x: 401, y: 750, text: '22/08/2026' },
    ];
    transactions.forEach((tx, index) => {
      runs.push(...transactionRuns(700 - index * 20, tx));
    });
    // quadro-resumo dividindo a mesma y do primeiro lancamento
    runs.push({ x: 340, y: 700, text: '(-) LIMITE DISPONIVEL' });
    runs.push({ x: 500, y: 700, text: '1.000,00' });
    runs.push({ x: 340, y: 600, text: '(=) VALOR TOTAL DA FATURA' });
    runs.push({ x: 500, y: 600, text: total });
    runs.push({ x: DATE_X, y: 60, text: 'Parcele sua fatura no app' });
    return buildPositionedPdf(runs);
  }

  const casos: [StatementTransaction[], string][] = [
    [
      [
        { date: '22/08', description: 'SUPERMERCADO ANONIMO', value: '154,32' },
        { date: '23/08', description: 'MAGAZINE ANONIMA PARCELA 03/10', value: '250,00' },
        { date: '24/08', description: 'PAGAMENTO RECEBIDO', value: '-100,00' },
      ],
      '304,32',
    ],
    [
      [
        { date: '05/07', description: 'FARMACIA ANONIMA', value: '45,00' },
        { date: '09/07', description: 'RESTAURANTE ANONIMO', value: '80,00' },
      ],
      '125,00',
    ],
  ];

  it.each(casos)('soma das transacoes = total do resumo', async (transactions, total) => {
    const bytes = statementPdf(transactions, total);
    const items = await extractPdfTextItems(bytes);
    // Sem `defaultYear`: o ano tem de sair do proprio documento (§8.2).
    const result = parseSantanderPdf(
      groupIntoRows(items, { xBands: SANTANDER_X_BANDS }),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.rows).toHaveLength(transactions.length);
    expect(result.rows.every((row) => row.occurredOn !== null)).toBe(true);

    const sum = result.rows.reduce((acc, row) => acc + (row.amountCents ?? 0), 0);
    expect(sum).toBe(result.reportedTotalCents);
    expect(result.reportedTotalCents).not.toBeNull();
  });

  it('agrupar sem xBands nao inventa lancamento nem perde o real', async () => {
    const bytes = statementPdf(
      [
        { date: '22/08', description: 'SUPERMERCADO ANONIMO', value: '154,32' },
        { date: '23/08', description: 'FARMACIA ANONIMA', value: '45,00' },
      ],
      '199,32',
    );
    const items = await extractPdfTextItems(bytes);

    // Sem xBands a linha fica contaminada, mas o parser segmenta por celula.
    const result = parseSantanderPdf(groupIntoRows(items), { defaultYear: 2026 });

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.rawDescription)).toEqual([
      'SUPERMERCADO ANONIMO',
      'FARMACIA ANONIMA',
    ]);
  });
});

describe('parseSantanderPdf — caminho cifrado (RC4) continua seguro', () => {
  it('PDF cifrado sem senha lanca PdfPasswordError, nunca "sem camada de texto"', async () => {
    await expect(extractPdfTextItems(buildEncryptedPdf())).rejects.toBeInstanceOf(
      PdfPasswordError,
    );
  });
});
