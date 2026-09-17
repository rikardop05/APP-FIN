import { describe, expect, it } from 'vitest';

import {
  buildEmptyPdf,
  buildEncryptedPdf,
  buildPositionedPdf,
  buildSubsetHexPdf,
  buildSubsetPdf,
  buildTextPdf,
} from '@/lib/import/pdf/__fixtures__/synthetic-pdf';

const decoder = new TextDecoder();

function header(bytes: Uint8Array): string {
  return decoder.decode(bytes.slice(0, 5));
}

describe('fixtures sinteticas de PDF', () => {
  it('todo construtor produz um PDF com cabecalho e EOF', () => {
    const fixtures = [
      buildTextPdf(['Nubank']),
      buildPositionedPdf([{ x: 10, y: 700, text: 'a' }]),
      buildSubsetPdf(['Ação']),
      buildSubsetHexPdf(['Ação']),
      buildEmptyPdf(),
      buildEncryptedPdf(),
    ];

    for (const bytes of fixtures) {
      expect(bytes.length).toBeGreaterThan(0);
      expect(header(bytes)).toBe('%PDF-');
      expect(decoder.decode(bytes)).toContain('%%EOF');
    }
  });

  it('o subset declara ToUnicode e o cifrado declara /Encrypt', () => {
    expect(decoder.decode(buildSubsetPdf(['Ação']))).toContain('/ToUnicode');
    expect(decoder.decode(buildEncryptedPdf())).toContain('/Encrypt');
  });
});
