import { describe, expect, it } from 'vitest';

import { uploadResponseSchema } from './schemas';

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

  it('recusa kind desconhecido', () => {
    expect(() => uploadResponseSchema.parse(response({ date: '2026-07-20', kind: 'whatever' }))).toThrow();
  });
});
