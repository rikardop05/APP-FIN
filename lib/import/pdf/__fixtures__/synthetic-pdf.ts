/**
 * Fixtures sinteticas de PDF — T-117.
 *
 * Nenhum byte aqui vem de fatura real (CONVENTIONS §9, RNF-01): as faturas da
 * familia carregam nome completo, digitos de cartao e endereco, e nao podem
 * passar por agente em provedor de terceiro nem entrar em caminho versionado.
 * Em vez de anonimizar um arquivo real, os testes **constroem** os PDFs que
 * precisam, de forma deterministica, no proprio teste.
 *
 * Cada construtor reproduz uma mecanica que a sonda registrou em
 * `IMPORT-SOURCES.md` §2:
 *
 * - `buildTextPdf` — strings literais com fonte simples (o caso trivial).
 * - `buildPositionedPdf` — cada celula como run posicionado. E o que obriga a
 *   remontagem por coordenada (o caso do Santander: 884 runs, 1 linha completa).
 * - `buildSubsetPdf` — fonte Type0 com subset e `ToUnicode` **arbitrario**: os
 *   codigos de glifo sao atribuidos na ordem de aparicao, sem relacao com o
 *   Unicode. So a decodificacao pelo `ToUnicode` do arquivo devolve o texto
 *   certo; um offset chumbado devolveria lixo (o caso do Nubank).
 * - `buildSubsetHexPdf` — o mesmo subset, mas com os codigos dentro de um array
 *   (`[<...>] TJ`), como a fonte CID do Mercado Pago.
 * - `buildEmptyPdf` — pagina sem texto: "PDF sem camada de texto".
 * - `buildEncryptedPdf` — dicionario `/Encrypt` valido, sem senha: forca o
 *   `PdfPasswordError` (o caso do Santander RC4 / Mercado Pago AES-256).
 *
 * Modulo puro (CONVENTIONS §5): sem I/O, sem `Date`, sem `process.env`. Todo o
 * PDF e ASCII, entao o offset do `xref` pode usar o comprimento da string.
 */

/** Concatena objetos numerados e escreve `xref`/`trailer` corretos. */
function assemble(objects: readonly string[], opts?: { encryptRef?: number; id?: string }): Uint8Array {
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  const encryptEntry =
    opts?.encryptRef === undefined ? '' : `/Encrypt ${opts.encryptRef} 0 R `;
  const idEntry = opts?.id === undefined ? '' : `/ID [${opts.id} ${opts.id}] `;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encryptEntry}${idEntry}>>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

/** Escapa os tres caracteres especiais de string literal de PDF. */
function escapeLiteral(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Pagina unica com uma fonte simples e um stream de conteudo. */
function simpleObjects(content: string, fontRef = 4): string[] {
  return [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${String(fontRef)} 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`,
  ];
}

interface PositionedRun {
  x: number;
  y: number;
  text: string;
}

/** Conteudo com um run por linha, cada um posicionado em `x`/`y`. */
function positionedContent(runs: readonly PositionedRun[], fontSize = 10): string {
  return runs
    .map(
      (run) =>
        `BT /F1 ${String(fontSize)} Tf ${String(run.x)} ${String(run.y)} Td (${escapeLiteral(run.text)}) Tj ET`,
    )
    .join('\n');
}

/**
 * PDF com uma linha por item, empilhadas de cima para baixo.
 *
 * Serve para testar o caminho de extracao simples; **cada linha e um run
 * unico**, entao nao exercita a remontagem por coordenada — para isso existe
 * `buildPositionedPdf`.
 */
export function buildTextPdf(lines: readonly string[]): Uint8Array {
  const content = lines
    .map(
      (line, index) =>
        `BT /F1 10 Tf 72 ${String(760 - index * 16)} Td (${escapeLiteral(line)}) Tj ET`,
    )
    .join('\n');
  return assemble(simpleObjects(content));
}

/**
 * PDF em que cada run e posicionado individualmente.
 *
 * E a forma como o Santander emite a fatura: data, descricao e valor sao runs
 * separados, e a linha so existe nas coordenadas. Alimenta o teste de ponta a
 * ponta `extract -> groupIntoRows`.
 */
export function buildPositionedPdf(runs: readonly PositionedRun[]): Uint8Array {
  return assemble(simpleObjects(positionedContent(runs)));
}

/**
 * Variante de multiplas paginas de `buildPositionedPdf`, com um array de runs por
 * pagina.
 *
 * Reproduz a geometria medida em `IMPORT-SOURCES.md` §6: o cabecalho se repete em
 * todas as paginas e as transacoes ficam na ultima. A pagina mede 595x842pt.
 */
export function buildPositionedPdfPages(
  pages: readonly (readonly PositionedRun[])[],
): Uint8Array {
  // Numeracao: 1 = catalog, 2 = pages, 3 = font, e cada pagina ocupa dois
  // objetos consecutivos (pagina e stream), a partir do 4.
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  const kids: string[] = [];
  pages.forEach((runs, index) => {
    const pageNumber = 4 + index * 2;
    const contentNumber = pageNumber + 1;
    kids.push(`${String(pageNumber)} 0 R`);
    const content = positionedContent(runs);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(contentNumber)} 0 R >>`,
      `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`,
    );
  });

  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${String(pages.length)} >>`;
  return assemble(objects);
}

/** PDF com pagina e stream, mas sem nenhum glifo de texto. */
export function buildEmptyPdf(): Uint8Array {
  return assemble(simpleObjects('BT /F1 10 Tf 72 760 Td () Tj ET'));
}

/**
 * Mapa caractere -> codigo de glifo, atribuido na ordem de aparicao a partir de
 * `0x1000`. A ausencia de relacao com o Unicode e o ponto: prova que a leitura
 * passa pelo `ToUnicode` e nao por um deslocamento fixo.
 */
const FIRST_GLYPH_CODE = 0x1000;
const CMAP_ENTRIES_PER_BLOCK = 100;

function buildSubsetObjects(
  lines: readonly string[],
  opts?: { array: boolean },
): { objects: string[]; content: string } {
  const codeOf = new Map<string, number>();
  let nextCode = FIRST_GLYPH_CODE;

  const encodeHex = (text: string): string => {
    let hex = '';
    for (const char of text) {
      let code = codeOf.get(char);
      if (code === undefined) {
        code = nextCode;
        codeOf.set(char, code);
        nextCode += 1;
      }
      hex += code.toString(16).padStart(4, '0');
    }
    return hex;
  };

  // Fonte Identity-H: o texto no stream sao os **codigos de glifo**, nunca a
  // string Unicode. Por isso hex e nao string literal — os codigos nao sao
  // ASCII e um literal carregaria bytes que o CMap nao conhece.
  const content = lines
    .map((line, index) => {
      const codes = `<${encodeHex(line)}>`;
      const shown = opts?.array ? `[${codes}]` : codes;
      const operator = opts?.array ? 'TJ' : 'Tj';
      return `BT /F1 10 Tf 72 ${String(760 - index * 16)} Td ${shown} ${operator} ET`;
    })
    .join('\n');

  const entries = [...codeOf.entries()].map(
    ([char, code]) =>
      `<${code.toString(16).padStart(4, '0')}> <${(char.codePointAt(0) ?? 0xfffd).toString(16).padStart(4, '0')}>`,
  );

  const blocks: string[] = [];
  for (let start = 0; start < entries.length; start += CMAP_ENTRIES_PER_BLOCK) {
    const slice = entries.slice(start, start + CMAP_ENTRIES_PER_BLOCK);
    blocks.push(`${String(slice.length)} beginbfchar\n${slice.join('\n')}\nendbfchar`);
  }

  const cmap = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${blocks.join('\n')}
endcmap
CMapName currentdict /CMap defineresource pop
end
end
`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 8 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /AAAAAA+Synthetic /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 7 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /AAAAAA+Synthetic /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 6 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /AAAAAA+Synthetic /Flags 4 /FontBBox [-100 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>',
    `<< /Length ${String(cmap.length)} >>\nstream\n${cmap}\nendstream`,
    `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`,
  ];

  return { objects, content };
}

/**
 * PDF com fonte Type0 (subset) e `ToUnicode` arbitrario, codigos em hex.
 * Reprova qualquer decodificacao que nao consulte o CMap do arquivo.
 */
export function buildSubsetPdf(lines: readonly string[]): Uint8Array {
  return assemble(buildSubsetObjects(lines, { array: false }).objects);
}

/** Variante com os codigos dentro de um array (`[<...>] TJ`), como a fonte CID do Mercado Pago. */
export function buildSubsetHexPdf(lines: readonly string[]): Uint8Array {
  return assemble(buildSubsetObjects(lines, { array: true }).objects);
}

/**
 * PDF com `/Encrypt` sintaticamente valido e sem senha correta.
 *
 * O conteudo nao esta cifrado de verdade — o objetivo do teste de T-117 e a
 * **reacao a falta de senha** (lancar `PdfPasswordError`), nao a decifragem. A
 * senha correta e coberta pelas fixtures RC4/AES-256 de T-117b/T-117c.
 */
export function buildEncryptedPdf(lines: readonly string[] = ['Teste']): Uint8Array {
  const content = positionedContent(
    lines.map((text, index) => ({ x: 72, y: 760 - index * 16, text })),
  );
  const objects = simpleObjects(content);

  // /V 1 /R 2 (RC4 40-bit) com /O e /U de tamanho correto: pdfjs le como
  // documento cifrado e recusa sem a senha.
  const owner = 'ab'.repeat(32);
  const user = 'cd'.repeat(32);
  objects.push(`<< /Filter /Standard /V 1 /R 2 /O <${owner}> /U <${user}> /P -44 >>`);

  return assemble(objects, {
    encryptRef: objects.length,
    id: '<0123456789abcdef0123456789abcdef>',
  });
}
