import { describe, expect, it } from 'vitest';

import { extractPdfTextItems } from '@/lib/import/pdf/extract';
import { buildEmptyPdf } from '@/lib/import/pdf/__fixtures__/synthetic-pdf';
import {
  NO_TEXT_LAYER_HINT,
  NO_TEXT_LAYER_MESSAGE,
  readFailureHint,
} from '@/lib/import/pdf/no-text';

const GENERIC = 'dica genérica';

describe('PDF sem camada de texto', () => {
  it('um PDF de imagem abre e devolve zero itens: é isso que a rota usa para avisar', async () => {
    await expect(extractPdfTextItems(buildEmptyPdf())).resolves.toEqual([]);
  });

  it('a dica específica só aparece para a mensagem de PDF sem texto', () => {
    expect(readFailureHint(NO_TEXT_LAYER_MESSAGE, GENERIC)).toBe(NO_TEXT_LAYER_HINT);
    expect(readFailureHint('Não foi possível reconhecer o banco neste PDF.', GENERIC)).toBe(GENERIC);
    expect(readFailureHint(null, GENERIC)).toBe(GENERIC);
  });

  it('a mensagem diz a causa e a dica diz a saída, sem culpar banco, cartão ou senha', () => {
    expect(NO_TEXT_LAYER_MESSAGE).toMatch(/imagem/);
    expect(NO_TEXT_LAYER_MESSAGE).not.toMatch(/reconhecer o banco/);
    expect(NO_TEXT_LAYER_HINT).toMatch(/original/);
    expect(NO_TEXT_LAYER_HINT).not.toMatch(/senha|competência/);
  });
});
