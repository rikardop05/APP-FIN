import { describe, expect, it } from 'vitest';

import { detectInstallment } from '@/lib/import/installments';
import { parseItauPdf } from '@/lib/import/pdf/itau';
import {
  itauFutureInstallmentsHeader,
  itauHeaderRow,
  itauSubtotalRow,
  itauTotalRows,
  itauTransactionHeader,
  itauTransactionRow,
  makeItauRow,
} from '@/lib/import/pdf/__fixtures__/itau';

describe('parseItauPdf', () => {
  it('retorna resultado vazio para arquivo sem linhas', () => {
    expect(parseItauPdf([])).toEqual({
      rows: [],
      diagnostics: [],
      reportedTotalCents: null,
      documentDate: null,
    });
  });

  it('lê a data de vencimento e o total oficial com sinal de saída', () => {
    const result = parseItauPdf([itauHeaderRow(), ...itauTotalRows()]);
    expect(result.documentDate).toEqual({ date: '2026-11-15', kind: 'due_date' });
    expect(result.reportedTotalCents).toBe(-8770);
  });

  it('remonta o layout medido, usa R$ em compra internacional e concilia o subtotal', () => {
    const result = parseItauPdf([
      itauHeaderRow(),
      ...itauTotalRows('R$ 87,70'),
      makeItauRow(657, [{ x: 151, text: 'Cartão final 1234' }], 2),
      itauTransactionHeader(),
      makeItauRow(640, [
        { x: 151, text: '11/08' },
        { x: 178, text: 'COMPRA INTERNACIONAL PARC 03/10' },
        { x: 323, text: '41,70' },
        { x: 367, text: 'US$ 8,15' },
        { x: 526, text: '8,15' },
      ], 2),
      makeItauRow(630, [
        { x: 178, text: 'CIDADE FICTICIA' },
        { x: 367, text: 'Limite disponível' },
        { x: 526, text: '2.000,00' },
      ], 2),
      itauTransactionRow(621, '12/08', 'COMPRA NACIONAL 03/10', '40,00'),
      itauTransactionRow(603, '13/08', 'ESTORNO SINTETICO', '- 5,00'),
      itauTransactionRow(585, '13/08', 'IOF SOBRE COMPRA', '3,00'),
      itauTransactionRow(567, '14/08', 'ENCARGOS FINANCEIROS', '8,00'),
      itauSubtotalRow(538, '87,70'),
      itauFutureInstallmentsHeader(),
      itauTransactionHeader(508),
      itauTransactionRow(499, '11/08', 'PARCELA FUTURA', '41,70'),
    ]);

    expect(result.rows).toHaveLength(5);
    expect(result.rows.map((row) => row.amountCents)).toEqual([-4170, -4000, 500, -300, -800]);
    expect(result.rows[0]?.occurredOn).toBe('2026-08-11');
    expect(result.rows[0]?.rawDescription).toContain('CIDADE FICTICIA');
    expect(result.rows[0]?.installment).toEqual({ current: 3, total: 10 });
    expect(result.rows[0]?.cardLast4).toBe('1234');
    const sum = result.rows.reduce((total, row) => total + (row.amountCents ?? 0), 0);
    expect(sum).toBe(-8770);
    expect(sum).toBe(result.reportedTotalCents);
    expect(result.diagnostics).toEqual([]);
  });

  it('reconhece pagamento da fatura anterior sem perder a linha', () => {
    const result = parseItauPdf([
      itauHeaderRow(),
      itauTransactionHeader(),
      itauTransactionRow(640, '12/08', 'Pagamento da fatura anterior', '-R$ 25,00'),
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.creditCardPayment).toBe(true);
  });

  it('associa os lançamentos ao final do cartão informado no cabeçalho', () => {
    const result = parseItauPdf([
      makeItauRow(660, [{ x: 151, text: 'Cartão final 1234' }], 2),
      itauTransactionHeader(),
      itauTransactionRow(640, '13/08', 'COMPRA', 'R$ 10,00'),
    ]);
    expect(result.rows[0]?.cardLast4).toBe('1234');
  });

  it('usa o ano informado pelo chamador quando o PDF não o imprime', () => {
    const result = parseItauPdf(
      [itauTransactionHeader(), itauTransactionRow(640, '11/08', 'COMPRA', 'R$ 10,00')],
      { defaultYear: 2025 },
    );
    expect(result.rows[0]?.occurredOn).toBe('2025-08-11');
  });

  it('preserva data sem ano como null quando falta referência e defaultYear', () => {
    const result = parseItauPdf([
      itauTransactionHeader(),
      itauTransactionRow(640, '11/08', 'COMPRA', 'R$ 10,00'),
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.occurredOn).toBeNull();
  });

  it('passa os quatro formatos de parcela existentes pelo detector compartilhado', () => {
    const descriptions = [
      'COMPRA PARC 03/10',
      'COMPRA 3/10',
      'COMPRA PARCELA 3 DE 10',
      'COMPRA (3 de 10)',
    ];
    const results = descriptions.map((description, index) =>
      parseItauPdf([
        itauTransactionHeader(),
        itauTransactionRow(640 - index * 18, '11/08', description, 'R$ 10,00'),
      ]),
    );
    expect(results.map((result) => result.rows[0]?.installment)).toEqual([
      { current: 3, total: 10 },
      { current: 3, total: 10 },
      { current: 3, total: 10 },
      { current: 3, total: 10 },
    ]);
    expect(detectInstallment('COMPRA (3 de 10)')?.cleanDescription).toBe('COMPRA');
  });

  it('mantém linha de data corrompida como diagnostic e continua o arquivo', () => {
    const result = parseItauPdf([
      itauHeaderRow(),
      itauTransactionHeader(),
      itauTransactionRow(640, '31/02', 'DATA CORROMPIDA', 'R$ 10,00'),
      itauTransactionRow(622, '12/08', 'COMPRA VALIDA', 'R$ 20,00'),
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.occurredOn).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.rows[1]?.occurredOn).toBe('2026-08-12');
  });

  it('mantém uma linha sem data como diagnostic e continua', () => {
    const result = parseItauPdf([
      itauHeaderRow(),
      itauTransactionHeader(),
      makeItauRow(640, [
        { x: 178, text: 'COMPRA SEM DATA' },
        { x: 323, text: 'R$ 10,00' },
      ], 2),
      itauTransactionRow(622, '12/08', 'COMPRA VALIDA', 'R$ 20,00'),
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.rows[0]?.occurredOn).toBe('2026-08-12');
  });

  it('não chuta lançamentos de uma tabela que continua na página seguinte sem cabeçalho DATA', () => {
    const result = parseItauPdf([
      itauHeaderRow(),
      itauTransactionHeader(),
      itauTransactionRow(640, '11/08', 'COMPRA NA PRIMEIRA PAGINA', '10,00'),
      makeItauRow(640, [
        { x: 151, text: '12/08' },
        { x: 178, text: 'LINHA SEM CABECALHO NA PAGINA SEGUINTE' },
        { x: 323, text: '20,00' },
      ], 3),
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.raw).toContain('12/08');
  });

  it('devolve data e valor ausentes como null sem apagar a linha', () => {
    const result = parseItauPdf([
      itauHeaderRow(),
      itauTransactionHeader(),
      makeItauRow(640, [
        { x: 151, text: '11/08' },
        { x: 178, text: 'COMPRA SEM VALOR' },
      ], 2),
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.amountCents).toBeNull();
    expect(result.rows[0]?.occurredOn).toBe('2026-08-11');
  });

  it('detecta pagamento zero como informativo', () => {
    const result = parseItauPdf([
      itauTransactionHeader(),
      itauTransactionRow(640, '11/08', 'ANUIDADE ISENTA', 'R$ 0,00'),
    ]);
    expect(result.rows[0]?.informational).toBe(true);
  });
});
