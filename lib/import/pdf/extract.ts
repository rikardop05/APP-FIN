/**
 * Extracao de texto de PDF — CONTRACTS §15 (`extractPdfTextItems`), T-117.
 *
 * Primeira metade do caminho de PDF da v1 (a segunda e `rows.ts`, `nubank.ts` e
 * `detect.ts`). Recebe os bytes crus de um arquivo e devolve os runs de texto
 * **com coordenadas**, ja decifrados e ja decodificados. Nao remonta linhas, nao
 * conhece banco e nao interpreta fatura: quem faz isso sao `groupIntoRows` e os
 * parsers por banco, que recebem o resultado desta funcao.
 *
 * ---
 *
 * ## Decisoes que valem registro
 *
 * 1. **pdfjs-dist e obrigatoria, e o extrator artesanal e proibido**
 *    (IMPORT-SOURCES §2, ORCHESTRATION §5). A sonda mostrou tres mecanicas
 *    diferentes — strings literais com subset Type0 (Nubank), cada celula como
 *    run posicionado (Santander) e strings hexadecimais com fonte CID (Mercado
 *    Pago). `pdfjs-dist` cobre as tres; SQL manual de stream nao cobriria a
 *    terceira.
 *
 * 2. **Assincrona por necessidade (CONTRACTS §15, corrigido em 2026-09-16).**
 *    `pdfjs-dist` so expoe `getDocument(...).promise` e `getTextContent()`, os
 *    dois assincronos. O contrato original declarava esta funcao sincrona, o que
 *    e fisicamente impossivel sem extrator artesanal. Os outros itens do bloco
 *    de PDF (`groupIntoRows`, `parseNubankPdf`, `detectPdfIssuer`) continuam
 *    sincronos: recebem dados ja extraidos.
 *
 * 3. **A decodificacao e do `ToUnicode` do proprio arquivo.** Esta funcao nao
 *    traduz codigo de glifo: entrega ao `pdfjs-dist` o PDF inteiro e deixa que
 *    ele aplique o CMap embutido. Offset de glifo chumbado no codigo e proibido
 *    (o subset do Nubank tem deslocamento que muda a cada redesign da fonte);
 *    o `ToUnicode` acompanha o arquivo e sobrevive ao redesign.
 *
 * 4. **PDF cifrado sem senha correta lanca `PdfPasswordError`, nunca devolve
 *    vazio.** "Sem camada de texto" e um documento que abre e nao tem texto; um
 *    documento que nao abre e outra coisa, e a UI precisa pedir a senha em vez
 *    de oferecer o texto colado (RF-IMP-11, ORCHESTRATION §5).
 *
 * 5. **A senha vive em memoria e so.** Ela e repassada ao `pdfjs-dist` e nunca
 *    entra em log, mensagem de erro, retorno ou estado. O `PdfPasswordError`
 *    carrega apenas o motivo (`missing`/`incorrect`) — a mensagem e fixa e nao
 *    ecoa o valor digitado.
 *
 * 6. **Runs vazios ou so de espaco sao descartados.** O `pdfjs-dist` emite um
 *    run por palavra e runs de espaco entre elas; um run de espaco nao tem
 *    glifo e so poluiria as celulas de `groupIntoRows`, que ja une por espaco.
 *
 * Modulo puro (CONVENTIONS §5): nao importa `lib/db`, `next/*`, `fs`, `fetch`
 * nem le `process.env`. Recebe bytes e devolve dados.
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Um run de texto posicionado na pagina, como o PDF o emite.
 *
 * `x` e `y` sao a origem do run em pontos, no espaco da pagina (mesma
 * orientacao do `transform` do PDF: `y` cresce para cima). `width` e a largura
 * do run em pontos. Nomes seguem o contrato; nao renomear sem mudar CONTRACTS.
 */
export interface PdfTextItem {
  /** Numero da pagina, a partir de 1. */
  page: number;
  /** Origem horizontal do run, em pontos. */
  x: number;
  /** Origem vertical do run, em pontos. */
  y: number;
  /** Largura do run, em pontos. */
  width: number;
  /** Texto ja decodificado pelo `ToUnicode` do arquivo. */
  text: string;
}

/** Opcoes de extracao. `password` e usada em memoria e nao e retornada. */
export interface PdfExtractOptions {
  /** Senha do PDF, quando cifrado (Santander RC4, Mercado Pago AES-256). */
  password?: string;
}

/** Por que a senha foi exigida: nao foi informada, ou nao confere. */
export type PdfPasswordReason = 'missing' | 'incorrect';

/**
 * Lancada quando o PDF esta cifrado e a senha nao abre o documento.
 *
 * Substitui a `PasswordException` do `pdfjs-dist` (que nao e exportada no topo
 * do pacote) para que o resto do sistema dependa de um tipo proprio, e para
 * garantir que a mensagem nunca carregue a senha digitada.
 */
export class PdfPasswordError extends Error {
  /** `'missing'` = o documento pede senha e nenhuma foi informada; `'incorrect'` = a informada nao confere. */
  readonly reason: PdfPasswordReason;

  constructor(reason: PdfPasswordReason) {
    super(
      reason === 'incorrect'
        ? 'Senha incorreta. Confira a senha da fatura e tente novamente.'
        : 'Este PDF está protegido por senha. Informe a senha da fatura para importar.',
    );
    this.name = 'PdfPasswordError';
    this.reason = reason;
  }
}

/**
 * Codigos de `PasswordResponses` do `pdfjs-dist`. Repetidos aqui porque o pacote
 * nao exporta a excecao no topo, e comparar pelo codigo numerico e mais estavel
 * que casar a mensagem em ingles.
 */
const PASSWORD_RESPONSE_INCORRECT = 2;

/** Valores que a opcao `verbosity` aceita; 0 silencia avisos de fonte padrao. */
const VERBOSITY_ERRORS = 0;

/** A excecao do `pdfjs-dist` se identifica por `name`, nao por `instanceof` (nao exportada). */
function isPasswordException(error: unknown): error is { code?: number } {
  return (
    error instanceof Error &&
    error.name === 'PasswordException'
  );
}

/** Extrai `code` da excecao do pdfjs sem confiar em `any`. */
function passwordReason(error: { code?: number }): PdfPasswordReason {
  return error.code === PASSWORD_RESPONSE_INCORRECT ? 'incorrect' : 'missing';
}

/**
 * Extrai os runs de texto de um PDF, com coordenadas, decifrando quando
 * necessario e decodificando sempre pelo `ToUnicode` do proprio arquivo.
 *
 * Lanca `PdfPasswordError` quando o documento esta cifrado e a senha (opcional)
 * nao abre — nunca devolve lista vazia nesse caso. Um PDF que abre sem texto
 * (imagem, capa) devolve `[]`, e isso **nao** e erro.
 *
 * ```ts
 * const items = await extractPdfTextItems(bytes);
 * const items = await extractPdfTextItems(bytes, { password: '12345678' });
 * ```
 */
export async function extractPdfTextItems(
  bytes: Uint8Array,
  opts?: PdfExtractOptions,
): Promise<PdfTextItem[]> {
  const loadingTask = getDocument({
    data: bytes,
    password: opts?.password,
    verbosity: VERBOSITY_ERRORS,
  });

  let doc: Awaited<typeof loadingTask.promise>;
  try {
    doc = await loadingTask.promise;
  } catch (error) {
    // A tarefa rejeitada ainda segura o worker/documento; sem destruir aqui,
    // uploads repetidos de PDF cifrado sem senha acumulariam estado do pdfjs
    // na rota de API. `destroy` e idempotente e nunca lanca por si.
    await loadingTask.destroy();
    if (isPasswordException(error)) {
      // Mensagem fixa: o valor de `opts.password` nunca aparece aqui.
      throw new PdfPasswordError(passwordReason(error));
    }
    throw error;
  }

  try {
    const items: PdfTextItem[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const item of content.items) {
        // `TextMarkedContent` nao tem `str`; so `TextItem` interessa.
        if (!('str' in item)) continue;
        // Run so de espaco nao tem glifo; `groupIntoRows` une as celulas por
        // espaco, entao mante-lo duplicaria separadores.
        if (item.str.trim() === '') continue;
        items.push({
          page: pageNumber,
          x: item.transform[4] ?? 0,
          y: item.transform[5] ?? 0,
          width: item.width,
          text: item.str,
        });
      }
      page.cleanup();
    }
    return items;
  } finally {
    await doc.destroy();
  }
}
