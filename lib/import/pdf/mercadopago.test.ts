import { describe, expect, it } from 'vitest';

import { PdfPasswordError, extractPdfTextItems } from '@/lib/import/pdf/extract';
import { parseMercadoPagoPdf } from '@/lib/import/pdf/mercadopago';
import { groupIntoRows } from '@/lib/import/pdf/rows';
import { buildEncryptedPdf, buildPositionedPdfPages } from '@/lib/import/pdf/__fixtures__/synthetic-pdf';
import {
  DATE_X,
  DESC_X,
  cardHeaderRow,
  headerRow,
  makeRow,
  pageNumberRow,
  statementPages,
  totalRow,
  transactionRow,
  valueX,
} from '@/lib/import/pdf/__fixtures__/mercadopago';

/**
 * Geometria MEDIDA da fatura Mercado Pago (docs/IMPORT-SOURCES.md §7): data em
 * `x=40`, descricao em `x=94`, parcela em coluna propria em `x≈395`, valor
 * alinhado a direita (~507–518) e cabecalho do ano em `y=776`.
 *
 * Fixture 100% sintetica: estabelecimentos, cartoes e valores inventados
 * (CONVENTIONS §9, RNF-01). Nenhum dado real de familia passa por aqui.
 */

describe('parseMercadoPagoPdf — armadilha 1: parcela em coluna propria', () => {
  it('extrai a parcela da coluna x≈395, nao da descricao', () => {
    const result = parseMercadoPagoPdf([
      headerRow(),
      cardHeaderRow(700, '1111'),
      transactionRow(680, {
        date: '05/07',
        description: 'PADARIA SINTETICA',
        value: 'R$ 20,00',
        installment: 'Parcela 1 de 12',
      }),
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.installment).toEqual({ current: 1, total: 12 });
    // A coluna de parcela nao entra na descricao.
    expect(result.rows[0]?.rawDescription).toBe('PADARIA SINTETICA');
    expect(result.rows[0]?.amountCents).toBe(-2000);
  });

  it('ainda usa detectInstallment quando a parcela vier na descricao', () => {
    // Defesa contra mudanca de layout: a coluna e a fonte principal, mas o
    // detector do T-121 continua sendo chamado como fallback.
    const result = parseMercadoPagoPdf([
      headerRow(),
      transactionRow(680, {
        date: '05/07',
        description: 'LOJA SINTETICA 03/10',
        value: 'R$ 20,00',
      }),
    ]);

    expect(result.rows[0]?.installment).toEqual({ current: 3, total: 10 });
  });

  it('sem parcela reconhecivel, installment e null', () => {
    const result = parseMercadoPagoPdf([
      headerRow(),
      transactionRow(680, {
        date: '05/07',
        description: 'PADARIA SINTETICA',
        value: 'R$ 20,00',
      }),
    ]);
    expect(result.rows[0]?.installment).toBeNull();
  });
});

describe('parseMercadoPagoPdf — armadilha 2: agrupamento por cartao', () => {
  it('preserva a secao de cada cartao no rawDescription quando ha mais de um', () => {
    const result = parseMercadoPagoPdf([
      headerRow(),
      cardHeaderRow(700, '1111'),
      transactionRow(680, {
        date: '05/07',
        description: 'PADARIA SINTETICA',
        value: 'R$ 20,00',
      }),
      cardHeaderRow(600, '2222'),
      transactionRow(580, {
        date: '12/07',
        description: 'FARMACIA SINTETICA',
        value: 'R$ 35,50',
      }),
    ]);

    expect(result.rows).toHaveLength(2);
    // O cabecalho de secao nao virou lancamento, e cada gasto ficou marcado com
    // o seu cartao: sem isso, os dois apareceriam somados como se fossem um.
    expect(result.rows[0]?.rawDescription).toBe('[final 1111] PADARIA SINTETICA');
    expect(result.rows[1]?.rawDescription).toBe('[final 2222] FARMACIA SINTETICA');
  });

  it('nao marca nada quando a fatura tem um cartao so', () => {
    const result = parseMercadoPagoPdf([
      headerRow(),
      cardHeaderRow(700, '1111'),
      transactionRow(680, {
        date: '05/07',
        description: 'PADARIA SINTETICA',
        value: 'R$ 20,00',
      }),
    ]);

    expect(result.rows[0]?.rawDescription).toBe('PADARIA SINTETICA');
  });

  it('nao marca nada quando nao ha secao de cartao', () => {
    const result = parseMercadoPagoPdf([
      headerRow(),
      transactionRow(680, {
        date: '05/07',
        description: 'PADARIA SINTETICA',
        value: 'R$ 20,00',
      }),
    ]);
    expect(result.rows[0]?.rawDescription).toBe('PADARIA SINTETICA');
  });

  it('lancamento antes da primeira secao sai como [final ?], nao misturado', () => {
    const result = parseMercadoPagoPdf([
      headerRow(),
      transactionRow(700, {
        date: '01/07',
        description: 'ANTES DA SECAO',
        value: 'R$ 10,00',
      }),
      cardHeaderRow(680, '1111'),
      transactionRow(660, {
        date: '05/07',
        description: 'PADARIA SINTETICA',
        value: 'R$ 20,00',
      }),
      cardHeaderRow(600, '2222'),
      transactionRow(580, {
        date: '12/07',
        description: 'FARMACIA SINTETICA',
        value: 'R$ 35,50',
      }),
    ]);

    expect(result.rows.map((row) => row.rawDescription)).toEqual([
      '[final ?] ANTES DA SECAO',
      '[final 1111] PADARIA SINTETICA',
      '[final 2222] FARMACIA SINTETICA',
    ]);
  });
});

describe('parseMercadoPagoPdf — armadilha 3: subtotal e cabecalho', () => {
  it('nao transforma a linha de Total em lancamento', () => {
    const result = parseMercadoPagoPdf([
      headerRow(),
      cardHeaderRow(700, '1111'),
      transactionRow(680, {
        date: '05/07',
        description: 'PADARIA SINTETICA',
        value: 'R$ 20,00',
      }),
      totalRow(620, 'R$ 20,00'),
    ]);

    // Sem a exigencia de data em x=40, o subtotal dobraria o gasto do mes.
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.amountCents).toBe(-2000);
    expect(result.reportedTotalCents).toBe(-2000);
  });

  it('nao transforma o cabecalho de vencimento em lancamento', () => {
    const result = parseMercadoPagoPdf([headerRow(), pageNumberRow(1, 1)]);
    expect(result.rows).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('com dois subtotais (fatura de varios cartoes) o total fica null', () => {
    const result = parseMercadoPagoPdf([
      headerRow(),
      cardHeaderRow(700, '1111'),
      transactionRow(680, {
        date: '05/07',
        description: 'PADARIA SINTETICA',
        value: 'R$ 20,00',
      }),
      totalRow(620, 'R$ 20,00'),
      cardHeaderRow(600, '2222'),
      transactionRow(580, {
        date: '12/07',
        description: 'FARMACIA SINTETICA',
        value: 'R$ 35,50',
      }),
      totalRow(520, 'R$ 35,50'),
    ]);

    expect(result.rows).toHaveLength(2);
    // Dois totais = nao ha como saber qual e o do documento; escolher seria chutar.
    expect(result.reportedTotalCents).toBeNull();
  });

  it('com 2+ cartoes e so um subtotal reconhecido, o total ainda e null', () => {
    // O subtotal e de UM cartao, nunca do documento (achado 1 da revisao): adotar
    // o unico reconhecido acusaria divergencia falsa no reconcileStatement.
    const result = parseMercadoPagoPdf([
      headerRow(),
      cardHeaderRow(700, '1111'),
      transactionRow(680, {
        date: '05/07',
        description: 'PADARIA SINTETICA',
        value: 'R$ 20,00',
      }),
      totalRow(620, 'R$ 20,00'),
      cardHeaderRow(600, '2222'),
      transactionRow(580, {
        date: '12/07',
        description: 'FARMACIA SINTETICA',
        value: 'R$ 35,50',
      }),
      // O Total da segunda secao nao foi reconhecido (variacao de layout).
    ]);

    expect(result.rows).toHaveLength(2);
    expect(result.reportedTotalCents).toBeNull();
  });

  it('data e descricao no mesmo run com a palavra Total nao engole o lancamento', () => {
    // Defesa da armadilha 3: a data tem precedencia sobre o marcador `Total`.
    const result = parseMercadoPagoPdf([
      headerRow(),
      makeRow(680, [
        { x: DATE_X, y: 680, text: '05/07 LOJA TOTAL SINTETICA' },
        { x: valueX('R$ 20,00'), y: 680, text: 'R$ 20,00' },
      ]),
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.occurredOn).toBe('2026-07-05');
    expect(result.rows[0]?.amountCents).toBe(-2000);
  });
});

describe('parseMercadoPagoPdf — valor e sinal', () => {
  it('le o valor alinhado a direita em x diferente por tamanho', () => {
    const result = parseMercadoPagoPdf([
      headerRow(),
      transactionRow(700, { date: '05/07', description: 'PADARIA', value: 'R$ 9,99' }),
      transactionRow(680, { date: '06/07', description: 'MERCADO', value: 'R$ 1.234,56' }),
    ]);

    expect(result.rows[0]?.amountCents).toBe(-999);
    expect(result.rows[1]?.amountCents).toBe(-123456);
  });

  it('inverte o sinal impresso: estorno com - vira entrada positiva', () => {
    const result = parseMercadoPagoPdf([
      headerRow(),
      transactionRow(680, {
        date: '14/07',
        description: 'ESTORNO SINTETICO',
        value: '-R$ 50,00',
      }),
    ]);
    expect(result.rows[0]?.amountCents).toBe(5000);
  });

  it('linha sem valor volta com amountCents null, sem sumir', () => {
    const semValor = makeRow(680, [
      { x: DATE_X, y: 680, text: '05/07' },
      { x: DESC_X, y: 680, text: 'PADARIA SINTETICA' },
    ]);
    const result = parseMercadoPagoPdf([headerRow(), semValor]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.amountCents).toBeNull();
    expect(result.rows[0]?.occurredOn).toBe('2026-07-05');
    expect(result.rows[0]?.rawDescription).toBe('PADARIA SINTETICA');
  });
});

describe('parseMercadoPagoPdf — resolucao do ano', () => {
  it('le o ano do cabecalho Vencimento: dd/MM/yyyy', () => {
    const result = parseMercadoPagoPdf([
      headerRow(),
      transactionRow(680, {
        date: '05/07',
        description: 'PADARIA SINTETICA',
        value: 'R$ 20,00',
      }),
    ]);
    expect(result.rows[0]?.occurredOn).toBe('2026-07-05');
  });

  it('usa o ano da competencia informada pelo chamador quando nao ha cabecalho', () => {
    const result = parseMercadoPagoPdf(
      [
        transactionRow(680, {
          date: '05/07',
          description: 'PADARIA SINTETICA',
          value: 'R$ 20,00',
        }),
      ],
      { defaultYear: 2025 },
    );
    expect(result.rows[0]?.occurredOn).toBe('2025-07-05');
  });

  it('sem cabecalho nem parametro, occurredOn null e a linha nao e engolida', () => {
    const result = parseMercadoPagoPdf([
      transactionRow(680, {
        date: '05/07',
        description: 'PADARIA SINTETICA',
        value: 'R$ 20,00',
      }),
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.occurredOn).toBeNull();
    expect(result.rows[0]?.amountCents).toBe(-2000);
    expect(result.diagnostics).toEqual([]);
  });

  it('aceita dd/MM/yyyy impresso na propria linha', () => {
    const result = parseMercadoPagoPdf([
      transactionRow(680, {
        date: '05/07/2024',
        description: 'PADARIA SINTETICA',
        value: 'R$ 20,00',
      }),
    ]);
    expect(result.rows[0]?.occurredOn).toBe('2024-07-05');
  });
});

describe('parseMercadoPagoPdf — linha inesperada e bordas', () => {
  it('linha sem data nao e engolida: vira diagnostic com o texto original', () => {
    // O Mercado Pago nao tem linha de continuacao (medicao do Orquestrador), mas
    // uma fatura futura pode trazer uma linha que o mapeamento nao previu. Sumir
    // em silencio e o unico desfecho proibido.
    const result = parseMercadoPagoPdf([
      headerRow(),
      transactionRow(680, {
        date: '05/07',
        description: 'PADARIA SINTETICA',
        value: 'R$ 20,00',
      }),
      makeRow(664, [{ x: DESC_X, y: 664, text: 'LINHA SEM DATA INESPERADA' }]),
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.raw).toBe('LINHA SEM DATA INESPERADA');
    expect(result.diagnostics[0]?.line).toBe(3);
  });

  it('cabecalho de coluna sem data e reconhecido e ignorado, sem diagnostic', () => {
    const result = parseMercadoPagoPdf([
      headerRow(),
      makeRow(730, [{ x: DESC_X, y: 730, text: 'Data Estabelecimento Valor em R$' }]),
      transactionRow(680, {
        date: '05/07',
        description: 'PADARIA SINTETICA',
        value: 'R$ 20,00',
      }),
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.diagnostics).toEqual([]);
  });

  it('linha de rodape fora da area de transacao e ignorada', () => {
    const result = parseMercadoPagoPdf([
      headerRow(),
      transactionRow(680, {
        date: '05/07',
        description: 'COMPRA SINTETICA',
        value: 'R$ 10,00',
      }),
      makeRow(20, [{ x: DESC_X, y: 20, text: 'Mercado Pago S.A.' }]),
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.rawDescription).toBe('COMPRA SINTETICA');
    expect(result.diagnostics).toEqual([]);
  });

  it('data inexistente no calendario vira diagnostic e a linha continua no lote', () => {
    const result = parseMercadoPagoPdf([
      headerRow(),
      transactionRow(680, {
        date: '31/02',
        description: 'PADARIA SINTETICA',
        value: 'R$ 20,00',
      }),
      transactionRow(660, {
        date: '05/07',
        description: 'MERCADO SINTETICO',
        value: 'R$ 10,00',
      }),
    ]);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.occurredOn).toBeNull();
    expect(result.rows[0]?.amountCents).toBe(-2000);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.line).toBe(2);
    // O lote nao aborta: a linha seguinte e lida normalmente.
    expect(result.rows[1]?.occurredOn).toBe('2026-07-05');
  });

  it('data malformada que tenta existir (99/99) tambem vira diagnostic', () => {
    const result = parseMercadoPagoPdf([
      headerRow(),
      transactionRow(680, {
        date: '99/99',
        description: 'PADARIA SINTETICA',
        value: 'R$ 20,00',
      }),
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.occurredOn).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
  });

  it('devolve resultado vazio para lista vazia', () => {
    expect(parseMercadoPagoPdf([])).toEqual({
      rows: [],
      diagnostics: [],
      reportedTotalCents: null,
    });
  });
});

describe('parseMercadoPagoPdf — o PDF cifrado nao vira "sem camada de texto"', () => {
  it('AES-256 sem senha lanca PdfPasswordError pela infra de extracao', async () => {
    // A decifragem e do T-117 (extract.ts); o Mercado Pago e AES-256 com fonte
    // CID. A fatura do teste tem /Encrypt e nenhuma senha: tem de lancar, nunca
    // devolver lista vazia (o vazio e o caso "sem camada de texto").
    const error = await extractPdfTextItems(buildEncryptedPdf()).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(PdfPasswordError);
    expect((error as PdfPasswordError).reason).toBe('missing');
  });
});

describe('parseMercadoPagoPdf — ponta a ponta com a geometria medida (§7)', () => {
  it('extract -> groupIntoRows -> parser: dois cartoes, parcela e soma corretas', async () => {
    const items = await extractPdfTextItems(
      buildPositionedPdfPages(statementPages()),
    );
    const result = parseMercadoPagoPdf(groupIntoRows(items));

    expect(result.diagnostics).toEqual([]);
    expect(result.rows).toHaveLength(3);

    // Armadilha 2: cada lancamento ficou com o seu cartao.
    expect(result.rows[0]?.rawDescription).toBe('[final 1111] PADARIA SINTETICA');
    expect(result.rows[1]?.rawDescription).toBe('[final 1111] MERCADO SINTETICO');
    expect(result.rows[2]?.rawDescription).toBe('[final 2222] FARMACIA SINTETICA');

    // Armadilha 1: parcela vinda da coluna propria.
    expect(result.rows[0]?.installment).toEqual({ current: 1, total: 12 });
    expect(result.rows[2]?.installment).toEqual({ current: 3, total: 6 });

    // Ano do cabecalho, repetido nas duas paginas.
    expect(result.rows.map((row) => row.occurredOn)).toEqual([
      '2026-07-05',
      '2026-07-10',
      '2026-07-12',
    ]);

    // Armadilha 3: os dois subtotais nao entraram; soma so das transacoes.
    const sum = result.rows.reduce((acc, row) => acc + (row.amountCents ?? 0), 0);
    expect(sum).toBe(-20550);
    expect(result.reportedTotalCents).toBeNull();
  });
});
