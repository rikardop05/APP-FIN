import { describe, expect, it } from 'vitest';

import { PdfPasswordError, extractPdfTextItems } from '@/lib/import/pdf/extract';
import {
  buildEmptyPdf,
  buildEncryptedPdf,
  buildPositionedPdf,
  buildSubsetHexPdf,
  buildSubsetPdf,
  buildTextPdf,
} from '@/lib/import/pdf/__fixtures__/synthetic-pdf';

describe('extractPdfTextItems — extracao com coordenadas', () => {
  it('extrai um run por linha, com pagina e coordenadas numericas', async () => {
    const items = await extractPdfTextItems(
      buildTextPdf(['Nubank', 'Total a pagar R$ 100,00']),
    );

    expect(items.map((item) => item.text)).toEqual([
      'Nubank',
      'Total a pagar R$ 100,00',
    ]);
    for (const item of items) {
      expect(item.page).toBe(1);
      expect(Number.isFinite(item.x)).toBe(true);
      expect(Number.isFinite(item.y)).toBe(true);
      expect(item.width).toBeGreaterThan(0);
    }
    // A segunda linha fica abaixo da primeira (y do PDF cresce para cima).
    expect(items[1]?.y).toBeLessThan(items[0]?.y ?? 0);
  });

  it('devolve runs posicionados separadamente (celula por run)', async () => {
    const items = await extractPdfTextItems(
      buildPositionedPdf([
        { x: 30, y: 700, text: '22/08' },
        { x: 120, y: 700, text: 'MERCADO CENTRAL' },
        { x: 400, y: 700, text: 'R$ 154,32' },
      ]),
    );

    expect(items.map((item) => item.text)).toEqual([
      '22/08',
      'MERCADO CENTRAL',
      'R$ 154,32',
    ]);
    const xs = items.map((item) => item.x);
    expect(xs[0]).toBeLessThan(xs[1] ?? 0);
    expect(xs[1]).toBeLessThan(xs[2] ?? 0);
  });

  it('decodifica subset Type0 pelo ToUnicode do arquivo (acento correto)', async () => {
    // A fonte tem offset arbitrario: passar por offset chumbado devolveria lixo.
    const items = await extractPdfTextItems(
      buildSubsetPdf(['Ação', 'Coração', 'João']),
    );
    expect(items.map((item) => item.text)).toEqual(['Ação', 'Coração', 'João']);
  });

  it('decodifica strings hexadecimais de fonte CID pelo ToUnicode', async () => {
    const items = await extractPdfTextItems(
      buildSubsetHexPdf(['Ação', 'São Paulo']),
    );
    const joined = items.map((item) => item.text).join(' ');
    expect(joined).toContain('Ação');
    expect(joined).toContain('São');
    expect(joined).toContain('Paulo');
  });
});

describe('extractPdfTextItems — bordas do aceite', () => {
  it('PDF sem camada de texto devolve lista vazia, sem lancar', async () => {
    await expect(extractPdfTextItems(buildEmptyPdf())).resolves.toEqual([]);
  });

  it('PDF cifrado sem senha lanca PdfPasswordError (reason missing)', async () => {
    const error = await extractPdfTextItems(buildEncryptedPdf()).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(PdfPasswordError);
    expect((error as PdfPasswordError).reason).toBe('missing');
    expect((error as PdfPasswordError).name).toBe('PdfPasswordError');
  });

  it('PDF cifrado com senha errada lanca PdfPasswordError (reason incorrect)', async () => {
    const error = await extractPdfTextItems(buildEncryptedPdf(), {
      password: '12345678',
    }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(PdfPasswordError);
    expect((error as PdfPasswordError).reason).toBe('incorrect');
  });

  it('a mensagem de erro nunca contem a senha digitada', async () => {
    const secret = 'senha-secreta-42';
    const error = await extractPdfTextItems(buildEncryptedPdf(), {
      password: secret,
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(PdfPasswordError);
    expect((error as PdfPasswordError).message).not.toContain(secret);
    expect((error as PdfPasswordError).stack ?? '').not.toContain(secret);
  });

  it('cifrado sem senha NAO e confundido com "sem camada de texto"', async () => {
    // Sem camada de texto abre e devolve vazio; cifrado sem senha nao abre.
    const empty = await extractPdfTextItems(buildEmptyPdf());
    expect(empty).toEqual([]);

    await expect(extractPdfTextItems(buildEncryptedPdf())).rejects.toBeInstanceOf(
      PdfPasswordError,
    );
  });

  it('arquivo vazio rejeita e nao vira PdfPasswordError', async () => {
    const error = await extractPdfTextItems(new Uint8Array(0)).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeDefined();
    expect(error).not.toBeInstanceOf(PdfPasswordError);
  });
});
