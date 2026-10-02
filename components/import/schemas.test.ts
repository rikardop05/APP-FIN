import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type { ImportPreview } from '@/lib/import/pipeline';
import { cents } from '@/lib/money';

import { previewSchema, uploadResponseSchema } from './schemas';

function response(documentDate?: unknown) {
  return {
    fileName: 'MercadoPago_2026-07-20.pdf',
    fileHash: 'abc',
    format: 'pdf',
    bankKey: 'mercadopago_card',
    sourceKind: 'credit_card',
    sourceId: '11111111-1111-4111-8111-111111111111',
    cardCycle: { closingDay: 14, dueDay: 20 },
    preview: {
      rows: [],
      summary: { rowsRead: 0, rowsNew: 0, rowsDuplicated: 0, installmentPlansDetected: 0, totalCents: 0, uncategorizedCount: 0 },
      diagnostics: [],
      ...(documentDate === undefined ? {} : { documentDate }),
      reportedTotalCents: null,
    },
    previousBatches: [],
  };
}

describe('uploadResponseSchema e a data impressa no documento', () => {
  it('PRESERVA documentDate (z.object descartaria a chave se o schema não a conhecesse)', () => {
    const parsed = uploadResponseSchema.parse(response({ date: '2026-07-20', kind: 'due_date' }));
    expect(parsed.preview.documentDate).toEqual({ date: '2026-07-20', kind: 'due_date' });
  });

  it('aceita null (texto colado, PDF sem cabeçalho reconhecido)', () => {
    expect(uploadResponseSchema.parse(response(null)).preview.documentDate).toBeNull();
  });

  it('falha ALTO se a rota deixar de mandar o campo, em vez de o aviso sumir', () => {
    expect(() => uploadResponseSchema.parse(response())).toThrow();
  });

  it('falha ALTO se a rota deixar de mandar reportedTotalCents (o commit gravaria NULL calado)', () => {
    const { reportedTotalCents: _omitted, ...previewWithout } = response(null).preview;
    expect(() => uploadResponseSchema.parse({ ...response(null), preview: previewWithout })).toThrow();
  });

  it('recusa kind desconhecido', () => {
    expect(() => uploadResponseSchema.parse(response({ date: '2026-07-20', kind: 'whatever' }))).toThrow();
  });
});

/**
 * Trava estrutural contra a classe de bug do `documentDate`: `z.object` descarta
 * chave desconhecida em silêncio, então um campo novo em `ImportPreview` (ou em
 * qualquer coisa que ele aninha) sumiria no cliente com tudo verde.
 *
 * - A igualdade de TIPOS é checada pelo `tsc --noEmit` (este arquivo está no
 *   `include`): campo a mais, a menos, opcional/obrigatório ou nulidade
 *   diferente em qualquer nível quebra a compilação.
 * - O teste de execução passa um preview com TODOS os campos preenchidos (nada
 *   `null`, para cada sub-objeto ser exercitado) e exige que volte idêntico.
 *   O fixture é tipado como `ImportPreview`, então um campo novo no tipo obriga
 *   a acrescentá-lo aqui.
 */
describe('previewSchema espelha ImportPreview', () => {
  it('z.infer do schema é exatamente o tipo do pipeline (checado pelo tsc)', () => {
    expectTypeOf<z.infer<typeof previewSchema>>().toEqualTypeOf<ImportPreview>();
    expectTypeOf<z.input<typeof previewSchema>>().toEqualTypeOf<ImportPreview>();
  });

  const fullPreview: ImportPreview = {
    rows: [
      {
        index: 0,
        occurredOn: '2026-07-03',
        competence: '2026-07',
        description: 'LOJA EXEMPLO',
        rawDescription: 'LOJA EXEMPLO 02/05',
        amountCents: cents(-12_345),
        dedupeHash: 'f'.repeat(64),
        suggestedCategoryId: '22222222-2222-4222-8222-222222222222',
        suggestedMemberId: '33333333-3333-4333-8333-333333333333',
        state: 'installment_part',
        installment: { current: 2, total: 5 },
      },
    ],
    summary: {
      rowsRead: 1,
      rowsNew: 1,
      rowsDuplicated: 0,
      installmentPlansDetected: 1,
      totalCents: cents(-12_345),
      uncategorizedCount: 0,
    },
    diagnostics: [{ line: 7, message: 'Linha não reconhecida.', raw: '?? 12,00' }],
    documentDate: { date: '2026-07-20', kind: 'due_date' },
    reportedTotalCents: cents(-12_345),
  };

  it('um preview completo atravessa o schema sem perder nenhuma chave', () => {
    // toStrictEqual: chave descartada pelo schema (ou acrescentada) falha aqui.
    expect(previewSchema.parse(fullPreview)).toStrictEqual(fullPreview);
  });

  it('o mesmo preview, dentro da resposta do upload, também chega inteiro', () => {
    const parsed = uploadResponseSchema.parse({ ...response(), preview: fullPreview });
    expect(parsed.preview).toStrictEqual(fullPreview);
  });
});
