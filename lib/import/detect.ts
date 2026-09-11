/**
 * Deteccao de origem — CONTRACTS §15 (`detectSource`), T-120.
 *
 * Primeira coisa que a rota de upload chama: recebe nome e bytes, responde
 * **qual caminho de importacao serve** e, quando nao serve nenhum, a frase que
 * a UI mostra ao usuario. Nao le arquivo, nao decodifica texto de PDF e nao
 * decide parser de banco — so olha extensao e assinatura de conteudo.
 *
 * Decisoes desta funcao, todas com consequencia visivel:
 *
 * 1. **A v1 aceita um formato: PDF.** `'unsupported'` cobre `.ofx`, `.csv`,
 *    `.xls` e `.xlsx` — o OFX porque nenhum dos tres bancos da familia o
 *    oferece (T-106 adiado), a planilha e o CSV porque a maquinaria de
 *    mapeamento de coluna foi adiada para a Fase 4 (T-105, T-118).
 *    `IMPORT-SOURCES.md` §3.1. `'unsupported'` **nao** e beco sem saida: vem
 *    sempre com `hint` orientando o texto colado (T-119), que e o fallback
 *    universal e cobre qualquer origem.
 *
 * 2. **Conteudo manda mais que extensao.** `.csv` que comeca com `%PDF` e um
 *    PDF renomeado, e le-lo como PDF e o que o usuario quer. A extensao so
 *    decide quando nenhuma assinatura fecha.
 *
 * 3. **Nunca lanca.** Entrada malformada — objeto vazio, `content` de tipo
 *    inesperado, nome sem extensao — devolve `format: null`, nao excecao: esta
 *    funcao roda na borda do upload, onde a resposta util e "nao reconheci" com
 *    orientacao, e nao um 500.
 *
 * 4. **`encrypted` e um palpite util, nao um veredito.** E `true` quando os
 *    bytes do PDF contem `/Encrypt`, o que serve para a UI ja pedir a senha
 *    (RF-IMP-11) antes de gastar uma tentativa de abertura. Quem responde de
 *    verdade e o `pdfjs-dist` no T-117, que lanca `PdfPasswordError`. Falso
 *    positivo aqui custa um campo de senha a mais na tela; falso negativo custa
 *    uma ida e volta.
 *
 * 5. **`bankKey` tambem e palpite, e so para PDF.** Quem identifica o emissor
 *    de verdade e `detectPdfIssuer` (T-117), sobre o texto ja decodificado.
 *    Aqui o sinal e o nome do arquivo e, quando o PDF nao esta cifrado, uma
 *    ocorrencia literal do nome do banco nos bytes — nenhum stream e
 *    descomprimido e nenhum glifo e decodificado, porque extracao de texto de
 *    PDF acontece so pelo `pdfjs-dist` (IMPORT-SOURCES §2). Sinais que se
 *    contradizem devolvem `null`: chutar o banco errado escolheria o parser
 *    errado.
 *
 * Modulo puro (CONVENTIONS §5): sem I/O, sem `process.env`, sem `Date`.
 */

/** Formatos que a v1 sabe classificar. `'unsupported'` sempre acompanha `hint`. */
export type SourceFormat = 'pdf' | 'unsupported';

/** Retorno de `detectSource`. */
export interface DetectedSource {
  /** `'pdf'` = importavel na v1; `'unsupported'` = formato conhecido e adiado; `null` = nao reconhecido. */
  format: SourceFormat | null;
  /** Chave do banco em `IMPORT-SOURCES.md` §1, quando os sinais concordam. Palpite. */
  bankKey: string | null;
  /** PDF protegido por senha (RF-IMP-11). Sempre `false` fora de PDF. */
  encrypted: boolean;
  /** Frase pt-BR para a UI. `null` quando nao ha nada a explicar. */
  hint: string | null;
}

/**
 * ISO 32000-1 §7.5.2: o cabecalho `%PDF-` fica no inicio do arquivo, e leitores
 * toleram lixo antes dele. 1024 bytes e a janela que os leitores usam.
 */
const PDF_HEADER = '%PDF-';
const PDF_HEADER_WINDOW = 1024;

/** Entrada do dicionario de criptografia no trailer. Ver decisao 4 no topo. */
const PDF_ENCRYPT_MARKER = '/Encrypt';

/**
 * Assinaturas de OFX. `OFXHEADER` abre a variante SGML (OFX 1.x), `<?OFX` a
 * instrucao de processamento da variante XML (OFX 2.x), e `<OFX>` a raiz das
 * duas. Procuradas no inicio do arquivo, onde o cabecalho vive.
 */
const OFX_SIGNATURES: readonly string[] = ['OFXHEADER', '<?OFX', '<OFX>'];
const OFX_SIGNATURE_WINDOW = 4096;

/** Extensoes de formato conhecido e adiado (Fase 4). Ver decisao 1 no topo. */
const OFX_EXTENSIONS: readonly string[] = ['ofx'];
const SPREADSHEET_EXTENSIONS: readonly string[] = ['csv', 'xls', 'xlsx'];

/**
 * Planilha **nao** e detectada por conteudo, de proposito: `.xlsx` e um zip
 * (assinatura `PK`) igual a `.docx`, `.jar` e qualquer outro container, e
 * `.xls` e um documento OLE2 igual a um `.doc`. Classificar todo zip como
 * planilha afirmaria mais do que os bytes dizem. Extensao basta: nao existe
 * caminho da v1 que leia planilha, entao o unico efeito e a frase mostrada.
 */

const HINT_PASTE =
  'Abra o arquivo, copie o conteúdo e cole no campo de texto da importação.';

const HINT_OFX = `Arquivos OFX ainda não são aceitos nesta versão. ${HINT_PASTE}`;

const HINT_SPREADSHEET = `Planilhas e arquivos CSV ainda não são aceitos nesta versão. ${HINT_PASTE}`;

const HINT_UNKNOWN = `Não foi possível identificar o formato deste arquivo. Se ele tiver texto, você ainda pode importá-lo: ${HINT_PASTE}`;

const HINT_PDF_ENCRYPTED =
  'Este PDF está protegido por senha. Informe a senha da fatura para importar.';

const HINT_PDF_BROKEN = `Este arquivo tem extensão .pdf, mas não traz o cabeçalho %PDF — pode estar corrompido ou ter sido renomeado. ${HINT_PASTE}`;

/**
 * Marcadores por banco. `fileNameTokens` sao comparados contra o nome
 * normalizado em tokens; `contentTokens`, contra os bytes.
 *
 * Todos apontam para `_card` porque o PDF, na v1, existe so para fatura de
 * cartao nos tres bancos (`IMPORT-SOURCES.md` §1) — extrato de conta nao tem
 * caminho de PDF, entao nao ha o que desambiguar entre cartao e conta.
 *
 * `mp` so vale no nome do arquivo (`Fatura_MP_20260720.pdf`), e so como token
 * inteiro: duas letras soltas dentro dos bytes de um PDF nao sao evidencia.
 */
const BANK_MARKERS: readonly {
  bankKey: string;
  fileNameTokens: readonly string[];
  contentTokens: readonly string[];
}[] = [
  {
    bankKey: 'nubank_card',
    fileNameTokens: ['nubank'],
    contentTokens: ['nubank'],
  },
  {
    bankKey: 'santander_card',
    fileNameTokens: ['santander'],
    contentTokens: ['santander'],
  },
  {
    bankKey: 'mercadopago_card',
    fileNameTokens: ['mercadopago', 'mercado pago', 'mp'],
    contentTokens: ['mercadopago', 'mercado pago'],
  },
];

/** `true` para os dois tipos que `content` aceita. Qualquer outra coisa e entrada malformada. */
function isReadableContent(value: unknown): value is string | Uint8Array {
  return typeof value === 'string' || value instanceof Uint8Array;
}

/** Codigo do byte/caractere na posicao, ou `-1` fora do intervalo. */
function codeAt(content: string | Uint8Array, index: number): number {
  if (typeof content === 'string') {
    const code = content.charCodeAt(index);
    return Number.isNaN(code) ? -1 : code;
  }
  return content[index] ?? -1;
}

/** Minuscula de ASCII, so para A-Z. Assinatura de arquivo nao tem acento. */
function lowerAscii(code: number): number {
  return code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
}

/**
 * Procura uma agulha ASCII em `content`, byte a byte, sem materializar string.
 *
 * Trabalhar sobre os codigos evita decodificar megabytes de PDF so para achar
 * `/Encrypt`, e evita escolher um encoding para bytes que nao sao texto.
 */
function containsAscii(
  content: string | Uint8Array,
  needle: string,
  opts?: { limit?: number; caseInsensitive?: boolean },
): boolean {
  const caseInsensitive = opts?.caseInsensitive ?? false;
  const end = Math.min(content.length, opts?.limit ?? content.length);

  const needleCodes: number[] = [];
  for (let index = 0; index < needle.length; index += 1) {
    const code = needle.charCodeAt(index);
    needleCodes.push(caseInsensitive ? lowerAscii(code) : code);
  }
  if (needleCodes.length === 0) return false;

  const last = end - needleCodes.length;
  for (let start = 0; start <= last; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needleCodes.length; offset += 1) {
      const code = codeAt(content, start + offset);
      const normalized = caseInsensitive ? lowerAscii(code) : code;
      if (normalized !== needleCodes[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/** Extensao em minusculas, sem ponto. `''` quando nao ha. Ignora diretorio nos dois separadores. */
function extensionOf(fileName: string): string {
  const trimmed = fileName.trim().toLowerCase();
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const base = trimmed.slice(cut + 1);
  const dot = base.lastIndexOf('.');
  // `dot <= 0`: sem ponto, ou nome que so tem extensao ('.pdf') — nos dois
  // casos nao ha extensao a afirmar.
  return dot <= 0 ? '' : base.slice(dot + 1);
}

/**
 * Nome reduzido a tokens: minusculas, tudo que nao e letra ou digito vira
 * espaco, e a string fica cercada por espacos. Assim `includes(' mp ')` casa o
 * token inteiro e nao o `mp` de "campo" ou "compra".
 */
function tokenizeFileName(fileName: string): string {
  const cut = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'));
  const base = fileName.slice(cut + 1).toLowerCase();
  return ` ${base.replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

/**
 * Banco sugerido pelo nome e pelos bytes. `null` quando nenhum sinal aparece —
 * e tambem quando dois bancos diferentes aparecem, porque nesse caso a
 * evidencia se anula. Ver decisao 5 no topo.
 */
function detectBankKey(
  fileName: string,
  content: string | Uint8Array,
): string | null {
  const tokens = tokenizeFileName(fileName);
  const found = new Set<string>();

  for (const marker of BANK_MARKERS) {
    // `||` curto-circuita de proposito: quando o nome ja decidiu, nao ha por
    // que varrer os bytes do arquivo inteiro atras do mesmo banco.
    const matched =
      marker.fileNameTokens.some((token) => tokens.includes(` ${token} `)) ||
      marker.contentTokens.some((token) =>
        containsAscii(content, token, { caseInsensitive: true }),
      );
    if (matched) found.add(marker.bankKey);
  }

  if (found.size !== 1) return null;
  // `?? null` so por causa de noUncheckedIndexedAccess; o tamanho ja foi checado.
  return [...found][0] ?? null;
}

/**
 * Classifica a origem de um upload. Ver as cinco decisoes no topo do arquivo.
 *
 * Nunca lanca: entrada que nao da para classificar volta com `format: null` e
 * `hint` orientando o caminho de texto colado.
 */
export function detectSource(input: {
  fileName: string;
  content: string | Uint8Array;
}): DetectedSource {
  const source: { fileName?: unknown; content?: unknown } =
    input !== null && typeof input === 'object' ? input : {};
  const fileName = typeof source.fileName === 'string' ? source.fileName : '';
  const content: string | Uint8Array = isReadableContent(source.content)
    ? source.content
    : '';

  const extension = extensionOf(fileName);

  // 1. Assinatura de conteudo, que manda mais que a extensao (decisao 2).
  if (containsAscii(content, PDF_HEADER, { limit: PDF_HEADER_WINDOW })) {
    const encrypted = containsAscii(content, PDF_ENCRYPT_MARKER);
    return {
      format: 'pdf',
      bankKey: detectBankKey(fileName, content),
      encrypted,
      hint: encrypted ? HINT_PDF_ENCRYPTED : null,
    };
  }

  const looksLikeOfx = OFX_SIGNATURES.some((signature) =>
    containsAscii(content, signature, {
      limit: OFX_SIGNATURE_WINDOW,
      caseInsensitive: true,
    }),
  );
  if (looksLikeOfx) {
    return { format: 'unsupported', bankKey: null, encrypted: false, hint: HINT_OFX };
  }

  // 2. Extensao, quando nenhuma assinatura fecha.
  if (OFX_EXTENSIONS.includes(extension)) {
    return { format: 'unsupported', bankKey: null, encrypted: false, hint: HINT_OFX };
  }
  if (SPREADSHEET_EXTENSIONS.includes(extension)) {
    return {
      format: 'unsupported',
      bankKey: null,
      encrypted: false,
      hint: HINT_SPREADSHEET,
    };
  }
  if (extension === 'pdf') {
    // Extensao diz PDF e os bytes nao confirmam: o honesto e nao afirmar o
    // formato — e dizer por que, senao o usuario le "arquivo desconhecido"
    // olhando para um .pdf.
    return {
      format: null,
      bankKey: null,
      encrypted: false,
      hint: HINT_PDF_BROKEN,
    };
  }

  return { format: null, bankKey: null, encrypted: false, hint: HINT_UNKNOWN };
}
