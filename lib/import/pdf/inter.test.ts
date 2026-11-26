import { describe, expect, it } from 'vitest';

import { detectPdfIssuer } from '@/lib/import/pdf/detect';
import { parseInterPdf } from '@/lib/import/pdf/inter';
import {
  interCardSection,
  interCardTotal,
  interCurrentStatementRow,
  interNextStatementRows,
  interPageHeaderRows,
  interSummaryRows,
  interTableHeader,
  interTransactionRow,
  makeInterRow,
} from '@/lib/import/pdf/__fixtures__/inter';

/** Duas seções de cartão, no mesmo desenho da fatura real medida. */
function statementRows() {
  return [
    ...interSummaryRows('175,60'),
    ...interPageHeaderRows(),
    interCurrentStatementRow('175,60'),
    makeInterRow(550, [{ x: 18, text: 'Despesas da fatura' }]),
    interCardSection(521, '0000****1111'),
    interTableHeader(501),
    interTransactionRow(480, '10 de jan. 2026', 'LOJA EXEMPLO ALFA (Parcela 05 de 06)', 'R$ 100,00'),
    interTransactionRow(460, '15 de out. 2026', 'ASSINATURA TESTE', 'R$ 5,90'),
    interTransactionRow(
      441,
      '20 de out. 2026',
      [
        { x: 77, text: 'P' },
        { x: 80, text: 'AGAMENTO DE FATURA' },
      ],
      '+ R$ 300,00',
    ),
    interTransactionRow(401, '03 de nov. 2026', 'ASSINATURA TESTE', 'R$ 4,50'),
    interCardTotal(381, '0000****1111', '110,40'),
    interCardSection(350, '0000****2222'),
    interTableHeader(330),
    interTransactionRow(309, '27 de nov. 2025', 'LOJA BETA (Parcela 12 de 12)', 'R$ 15,20'),
    interTransactionRow(289, '22 de out. 2026', 'APP GAMA (Parcela 01 de 04)', 'R$ 50,00'),
    interCardTotal(269, '0000****2222', '65,20'),
    ...interNextStatementRows(),
  ];
}

describe('parseInterPdf', () => {
  it('retorna resultado vazio para arquivo sem linhas', () => {
    expect(parseInterPdf([])).toEqual({
      rows: [],
      diagnostics: [],
      reportedTotalCents: null,
      documentDate: null,
    });
  });

  it('lê o vencimento da linha abaixo do rótulo e o total com sinal de saída', () => {
    const result = parseInterPdf(interSummaryRows('331,03', '20/11/2026'));
    expect(result.documentDate).toEqual({ date: '2026-11-20', kind: 'due_date' });
    expect(result.reportedTotalCents).toBe(-33103);
  });

  it('usa a linha "Fatura atual" quando é a única fonte do total', () => {
    const result = parseInterPdf([interCurrentStatementRow('331,03')]);
    expect(result.reportedTotalCents).toBe(-33103);
  });

  it('descarta o total quando as duas fontes divergem', () => {
    const result = parseInterPdf([...interSummaryRows('331,03'), interCurrentStatementRow('400,00')]);
    expect(result.reportedTotalCents).toBeNull();
  });

  it('não confunde o limite de crédito, na coluna da direita, com o total', () => {
    const result = parseInterPdf(interSummaryRows('331,03').filter((row) => row.y !== 464));
    expect(result.reportedTotalCents).toBeNull();
  });

  it('lê os lançamentos das duas seções com a data completa e o final do cartão', () => {
    const result = parseInterPdf(statementRows());

    expect(result.rows.map((row) => row.occurredOn)).toEqual([
      '2026-01-10',
      '2026-10-15',
      '2026-10-20',
      '2026-11-03',
      '2025-11-27',
      '2026-10-22',
    ]);
    expect(result.rows.map((row) => row.cardLast4)).toEqual([
      '1111',
      '1111',
      '1111',
      '1111',
      '2222',
      '2222',
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('trata compra como saída e "+ R$" como entrada', () => {
    const result = parseInterPdf(statementRows());
    expect(result.rows.map((row) => row.amountCents)).toEqual([
      -10000, -590, 30000, -450, -1520, -5000,
    ]);
  });

  it('reconhece o pagamento da fatura mesmo com a inicial quebrada em outro run', () => {
    const result = parseInterPdf(statementRows());
    const payment = result.rows[2];
    expect(payment?.rawDescription).toBe('PAGAMENTO DE FATURA');
    expect(payment?.creditCardPayment).toBe(true);
    expect(result.rows.filter((row) => row.creditCardPayment)).toHaveLength(1);
  });

  it('não cola duas palavras distintas de uma letra só', () => {
    const result = parseInterPdf([
      interCardSection(521, '0000****1111'),
      interTableHeader(501),
      interTransactionRow(
        480,
        '10 de jan. 2026',
        [
          { x: 77, text: 'LOJA' },
          { x: 100, text: 'E' },
          { x: 108, text: 'CIA' },
        ],
        'R$ 10,00',
      ),
    ]);
    expect(result.rows[0]?.rawDescription).toBe('LOJA E CIA');
  });

  it('lê a parcela impressa na descrição pelo detector compartilhado', () => {
    const result = parseInterPdf(statementRows());
    expect(result.rows.map((row) => row.installment)).toEqual([
      { current: 5, total: 6 },
      null,
      null,
      null,
      { current: 12, total: 12 },
      { current: 1, total: 4 },
    ]);
  });

  it('a soma dos lançamentos sem o pagamento da fatura fecha com o total da fatura', () => {
    const result = parseInterPdf(statementRows());
    const sum = result.rows
      .filter((row) => row.creditCardPayment !== true)
      .reduce((total, row) => total + (row.amountCents ?? 0), 0);
    expect(result.reportedTotalCents).toBe(-17560);
    expect(sum).toBe(result.reportedTotalCents);
  });

  it('não lê as parcelas da próxima fatura nem o cabeçalho repetido como lançamento', () => {
    const result = parseInterPdf(statementRows());
    expect(result.rows).toHaveLength(6);
    expect(result.rows.some((row) => row.rawDescription.includes('LOJA FUTURA'))).toBe(false);
  });

  it('ignora o cabeçalho repetido quando a seção atravessa a página', () => {
    const result = parseInterPdf([
      interCardSection(521, '0000****1111'),
      interTableHeader(501),
      interTransactionRow(480, '10 de out. 2026', 'COMPRA UM', 'R$ 10,00'),
      ...interPageHeaderRows(4),
      interTransactionRow(500, '11 de out. 2026', 'COMPRA DOIS', 'R$ 20,00', { page: 4 }),
    ]);
    expect(result.rows.map((row) => row.rawDescription)).toEqual(['COMPRA UM', 'COMPRA DOIS']);
    expect(result.rows[1]?.cardLast4).toBe('1111');
    expect(result.diagnostics).toEqual([]);
  });

  it('lê os doze meses abreviados, com e sem acento e com ponto opcional', () => {
    const months = [
      'jan.',
      'fev.',
      'mar.',
      'abr.',
      'mai.',
      'jun.',
      'jul.',
      'ago.',
      'set.',
      'out.',
      'nov.',
      'dez.',
      'mar',
      'março',
    ];
    const result = parseInterPdf([
      interCardSection(521, '0000****1111'),
      interTableHeader(501),
      ...months.map((month, index) =>
        interTransactionRow(480 - index * 18, `05 de ${month} 2026`, 'COMPRA', 'R$ 1,00'),
      ),
    ]);
    expect(result.rows.map((row) => row.occurredOn)).toEqual([
      '2026-01-05',
      '2026-02-05',
      '2026-03-05',
      '2026-04-05',
      '2026-05-05',
      '2026-06-05',
      '2026-07-05',
      '2026-08-05',
      '2026-09-05',
      '2026-10-05',
      '2026-11-05',
      '2026-12-05',
      '2026-03-05',
      '2026-03-05',
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('data que não existe no calendário vira diagnóstico e a linha é preservada', () => {
    const result = parseInterPdf([
      interCardSection(521, '0000****1111'),
      interTableHeader(501),
      interTransactionRow(480, '31 de fev. 2026', 'COMPRA IMPOSSIVEL', 'R$ 10,00'),
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.occurredOn).toBeNull();
    expect(result.rows[0]?.amountCents).toBe(-1000);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('data fora do formato conhecido, com valor, vira diagnóstico e não some', () => {
    const result = parseInterPdf([
      interCardSection(521, '0000****1111'),
      interTableHeader(501),
      interTransactionRow(480, '2026-10-15', 'COMPRA ESTRANHA', 'R$ 10,00'),
    ]);
    expect(result.rows).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.raw).toContain('COMPRA ESTRANHA');
  });

  it('anexa à transação anterior a linha de texto sem data nem valor', () => {
    const result = parseInterPdf([
      interCardSection(521, '0000****1111'),
      interTableHeader(501),
      interTransactionRow(480, '10 de out. 2026', 'COMPRA LONGA', 'R$ 10,00'),
      makeInterRow(471, [{ x: 77, text: 'COMPLEMENTO DO NOME' }]),
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.rawDescription).toBe('COMPRA LONGA COMPLEMENTO DO NOME');
    expect(result.diagnostics).toEqual([]);
  });

  it('inclui o beneficiário na descrição quando a coluna não é "-"', () => {
    const result = parseInterPdf([
      interCardSection(521, '0000****1111'),
      interTableHeader(501),
      interTransactionRow(480, '10 de out. 2026', 'PIX NO CREDITO', 'R$ 10,00', {
        beneficiary: 'FULANO DE TAL',
      }),
      interTransactionRow(460, '11 de out. 2026', 'LOJA', 'R$ 3,00'),
    ]);
    expect(result.rows.map((row) => row.rawDescription)).toEqual([
      'PIX NO CREDITO FULANO DE TAL',
      'LOJA',
    ]);
  });

  it('marca valor zero como informativo', () => {
    const result = parseInterPdf([
      interCardSection(521, '0000****1111'),
      interTableHeader(501),
      interTransactionRow(480, '10 de out. 2026', 'ANUIDADE ISENTA', 'R$ 0,00'),
    ]);
    expect(result.rows[0]?.informational).toBe(true);
  });

  it('lê valores com milhar', () => {
    const result = parseInterPdf([
      interCardSection(521, '0000****1111'),
      interTableHeader(501),
      interTransactionRow(480, '10 de out. 2026', 'COMPRA GRANDE', 'R$ 1.234,56'),
    ]);
    expect(result.rows[0]?.amountCents).toBe(-123456);
  });

  it('não lê data solta fora de uma seção de cartão', () => {
    const result = parseInterPdf([
      interTransactionRow(480, '10 de out. 2026', 'SEM SECAO', 'R$ 10,00'),
    ]);
    expect(result.rows).toEqual([]);
  });

  it('deixa de ler depois do total do cartão', () => {
    const result = parseInterPdf([
      interCardSection(521, '0000****1111'),
      interTableHeader(501),
      interTransactionRow(480, '10 de out. 2026', 'DENTRO', 'R$ 10,00'),
      interCardTotal(460, '0000****1111', '10,00'),
      interTransactionRow(440, '11 de out. 2026', 'FORA', 'R$ 99,00'),
    ]);
    expect(result.rows.map((row) => row.rawDescription)).toEqual(['DENTRO']);
  });
});

describe('detectPdfIssuer — Inter', () => {
  it('identifica a fatura pelo rodapé da página de limites', () => {
    const rows = [makeInterRow(23, [{ x: 54, text: 'www.bancointer.com.br' }], 4)];
    expect(detectPdfIssuer(rows)).toBe('inter');
  });

  it('identifica a fatura pela razão social do boleto', () => {
    const rows = [makeInterRow(300, [{ x: 100, text: 'BANCO INTER S/A CNPJ: 00.416.968\\0001-01' }], 6)];
    expect(detectPdfIssuer(rows)).toBe('inter');
  });

  it('não casa "Inter" dentro de outra palavra (IOF Internacional)', () => {
    const rows = [makeInterRow(100, [{ x: 36, text: 'IOF Internacional 3,50% am' }], 6)];
    expect(detectPdfIssuer(rows)).toBeNull();
  });
});
