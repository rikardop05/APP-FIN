import { describe, expect, it } from 'vitest';

import { detectSource } from '@/lib/import/detect';

/** Bytes ASCII, que e como o arquivo chega da rota de upload. */
function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Cabecalho minimo de PDF valido, sem cifra. */
const PDF_PLAIN = '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n';

/** Mesmo arquivo com dicionario de criptografia no trailer (Santander/Mercado Pago). */
const PDF_ENCRYPTED = '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 9 0 R >>\n%%EOF\n';

/** Cabecalho de OFX 1.x (SGML), que e como o formato se anuncia. */
const OFX_SGML = 'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\n\n<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>\n';

const PASTE_HINT = 'cole no campo de texto da importação';

describe('detectSource — PDF', () => {
  it('reconhece pelo header %PDF, em string e em bytes', () => {
    expect(detectSource({ fileName: 'fatura.pdf', content: PDF_PLAIN })).toEqual({
      format: 'pdf',
      bankKey: null,
      encrypted: false,
      hint: null,
    });
    expect(detectSource({ fileName: 'fatura.pdf', content: bytes(PDF_PLAIN) })).toEqual({
      format: 'pdf',
      bankKey: null,
      encrypted: false,
      hint: null,
    });
  });

  it('marca encrypted e ja pede a senha quando o trailer traz /Encrypt', () => {
    const result = detectSource({
      fileName: 'fatura.pdf',
      content: bytes(PDF_ENCRYPTED),
    });
    expect(result.format).toBe('pdf');
    expect(result.encrypted).toBe(true);
    expect(result.hint).toContain('protegido por senha');
  });

  it('tolera lixo antes do header, dentro dos 1024 bytes que o formato permite', () => {
    const padded = `${' '.repeat(900)}${PDF_PLAIN}`;
    expect(detectSource({ fileName: 'fatura.pdf', content: padded }).format).toBe('pdf');
  });

  it('nao aceita header fora da janela de 1024 bytes', () => {
    const tooFar = `${' '.repeat(2000)}${PDF_PLAIN}`;
    const result = detectSource({ fileName: 'fatura.pdf', content: tooFar });
    expect(result.format).toBeNull();
    expect(result.hint).toContain('não traz o cabeçalho %PDF');
  });

  it('assinatura de conteudo vence a extensao', () => {
    // PDF renomeado para .csv continua sendo PDF: le-lo e o que o usuario quer.
    expect(detectSource({ fileName: 'extrato.csv', content: PDF_PLAIN }).format).toBe(
      'pdf',
    );
  });

  it('extensao .pdf sem header nao vira formato, e explica por que', () => {
    const result = detectSource({ fileName: 'fatura.pdf', content: 'data;valor\n' });
    expect(result.format).toBeNull();
    expect(result.encrypted).toBe(false);
    expect(result.hint).toContain('não traz o cabeçalho %PDF');
    expect(result.hint).toContain(PASTE_HINT);
  });
});

describe('detectSource — formatos adiados para a Fase 4', () => {
  it('reconhece OFX pela assinatura de conteudo, mesmo com outro nome', () => {
    const result = detectSource({ fileName: 'extrato.txt', content: OFX_SGML });
    expect(result.format).toBe('unsupported');
    expect(result.hint).toContain('Arquivos OFX ainda não são aceitos');
    expect(result.hint).toContain(PASTE_HINT);
  });

  it('reconhece OFX 2.x (XML) e a raiz <OFX> sozinha', () => {
    expect(
      detectSource({
        fileName: 'extrato.dat',
        content: '<?xml version="1.0"?>\n<?OFX OFXHEADER="200"?>\n<OFX></OFX>',
      }).format,
    ).toBe('unsupported');
    expect(
      detectSource({ fileName: 'extrato.dat', content: '<ofx>\n<signonmsgsrsv1/>\n</ofx>' })
        .format,
    ).toBe('unsupported');
  });

  it('reconhece OFX pela extensao quando o conteudo nao se anuncia', () => {
    const result = detectSource({ fileName: 'extrato.ofx', content: 'conteudo truncado' });
    expect(result.format).toBe('unsupported');
    expect(result.hint).toContain('Arquivos OFX ainda não são aceitos');
  });

  it('devolve unsupported para .csv, .xls e .xlsx, orientando o texto colado', () => {
    for (const fileName of ['extrato.csv', 'extrato.xls', 'extrato.xlsx']) {
      const result = detectSource({ fileName, content: 'data;descricao;valor\n' });
      expect(result.format).toBe('unsupported');
      expect(result.encrypted).toBe(false);
      expect(result.hint).toContain('Planilhas e arquivos CSV ainda não são aceitos');
      expect(result.hint).toContain(PASTE_HINT);
    }
  });

  it('ignora caixa e caminho na extensao', () => {
    expect(
      detectSource({ fileName: 'C:\\Users\\r\\Downloads\\Extrato.XLSX', content: '' })
        .format,
    ).toBe('unsupported');
    expect(detectSource({ fileName: '/tmp/Fatura_092026.PDF', content: PDF_PLAIN }).format).toBe(
      'pdf',
    );
  });
});

describe('detectSource — desconhecido', () => {
  it('devolve null com orientacao para o que nao reconhece', () => {
    const result = detectSource({ fileName: 'notas.txt', content: 'compra no mercado' });
    expect(result.format).toBeNull();
    expect(result.bankKey).toBeNull();
    expect(result.encrypted).toBe(false);
    expect(result.hint).toContain('Não foi possível identificar o formato');
    expect(result.hint).toContain(PASTE_HINT);
  });

  it('arquivo vazio e nome vazio nao lancam', () => {
    expect(detectSource({ fileName: '', content: '' }).format).toBeNull();
    expect(detectSource({ fileName: '', content: bytes('') }).format).toBeNull();
    expect(detectSource({ fileName: 'semextensao', content: '' }).format).toBeNull();
    // Arquivo vazio com extensao conhecida continua sendo classificado pela extensao.
    expect(detectSource({ fileName: 'vazio.csv', content: '' }).format).toBe(
      'unsupported',
    );
  });

  it('nunca lanca com entrada malformada', () => {
    // `as`: a borda de upload pode entregar qualquer coisa; o contrato promete
    // que esta funcao classifica em vez de derrubar a rota.
    const malformed = [
      undefined,
      null,
      {},
      { fileName: 42, content: 42 },
      { fileName: 'x.pdf' },
      { content: PDF_PLAIN },
    ] as unknown as { fileName: string; content: string | Uint8Array }[];

    for (const input of malformed) {
      expect(() => detectSource(input)).not.toThrow();
    }
    expect(
      detectSource({ content: PDF_PLAIN } as unknown as {
        fileName: string;
        content: string;
      }).format,
    ).toBe('pdf');
  });
});

describe('detectSource — palpite de banco', () => {
  it('reconhece os tres bancos pelo nome do arquivo', () => {
    expect(
      detectSource({ fileName: 'Nubank_2026-09-09.pdf', content: PDF_PLAIN }).bankKey,
    ).toBe('nubank_card');
    expect(
      detectSource({ fileName: 'Fatura_Santander_092026.PDF', content: PDF_PLAIN })
        .bankKey,
    ).toBe('santander_card');
    expect(
      detectSource({ fileName: 'Fatura_MP_20260720.pdf', content: PDF_PLAIN }).bankKey,
    ).toBe('mercadopago_card');
  });

  it('reconhece pelo conteudo quando o nome nao diz nada', () => {
    expect(
      detectSource({
        fileName: 'documento.pdf',
        content: `${PDF_PLAIN}(Nubank Pagamentos S.A.)`,
      }).bankKey,
    ).toBe('nubank_card');
    expect(
      detectSource({
        fileName: 'documento.pdf',
        content: bytes(`${PDF_PLAIN}(Mercado Pago)`),
      }).bankKey,
    ).toBe('mercadopago_card');
  });

  it('devolve null quando dois bancos aparecem: evidencia contraditoria nao escolhe parser', () => {
    expect(
      detectSource({
        fileName: 'Nubank_2026-09-09.pdf',
        content: `${PDF_PLAIN}(Santander)`,
      }).bankKey,
    ).toBeNull();
  });

  it('nao confunde "mp" dentro de palavra com o token do Mercado Pago', () => {
    expect(
      detectSource({ fileName: 'compras_do_campo.pdf', content: PDF_PLAIN }).bankKey,
    ).toBeNull();
  });

  it('nao arrisca banco fora do caminho de PDF', () => {
    // Fora do PDF nao da para saber se e cartao ou conta, e nenhum consumidor
    // da v1 le este campo para formato adiado.
    expect(
      detectSource({ fileName: 'nubank_extrato.csv', content: 'data;valor' }).bankKey,
    ).toBeNull();
  });
});
