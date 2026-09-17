import { describe, expect, it } from 'vitest';

import { detectPdfIssuer } from '@/lib/import/pdf/detect';
import type { PdfTextRow } from '@/lib/import/pdf/rows';

function row(text: string, page = 1, y = 700): PdfTextRow {
  return { page, y, cells: [{ x: 0, text }], text };
}

describe('detectPdfIssuer', () => {
  it('reconhece Nubank, Santander e Mercado Pago pelo cabecalho', () => {
    expect(detectPdfIssuer([row('Nubank'), row('Fatura de setembro')])).toBe(
      'nubank',
    );
    expect(
      detectPdfIssuer([row('Banco Santander S.A.'), row('Vencimento')]),
    ).toBe('santander');
    expect(detectPdfIssuer([row('Mercado Pago'), row('Resumo')])).toBe(
      'mercadopago',
    );
    expect(detectPdfIssuer([row('MERCADO PAGO')])).toBe('mercadopago');
  });

  it('ignora caixa', () => {
    expect(detectPdfIssuer([row('nuBANK')])).toBe('nubank');
  });

  it('encontra o banco mesmo longe do cabecalho (marca no rodape, §6.3)', () => {
    const rows = [row('Fatura 15 SET 2026'), ...Array.from({ length: 40 }, () => row('ruido'))];
    rows.push(row('Nubank S.A.'));
    expect(detectPdfIssuer(rows)).toBe('nubank');
  });

  it('devolve null quando dois bancos aparecem (evidencia anulada)', () => {
    expect(detectPdfIssuer([row('Nubank'), row('Santander')])).toBeNull();
  });

  it('devolve null sem nenhum banco reconhecido', () => {
    expect(detectPdfIssuer([row('Fatura de cartão')])).toBeNull();
    expect(detectPdfIssuer([])).toBeNull();
  });
});
