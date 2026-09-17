/**
 * Identificacao do emissor do PDF — CONTRACTS §15 (`detectPdfIssuer`), T-117.
 *
 * Escolhe o parser de banco a partir do texto ja extraido e remontado em
 * linhas. Nao le bytes (isso e `detectSource`, T-120, que da um palpite pelo
 * nome do arquivo) e nao le glifo (isso e `extractPdfTextItems`): aqui o sinal e
 * a **palavra do banco no cabecalho da fatura**, ja decodificada.
 *
 * Decisoes:
 *
 * 1. **O nome do banco pode estar em qualquer linha.** A medicao da fatura
 *    Nubank (`IMPORT-SOURCES.md` §6.3) mostrou que o cabecalho traz nome do
 *    titular, fatura, emissao e periodo — e **nao** necessariamente a palavra
 *    "Nubank", que pode estar no rodape institucional ou numa imagem de marca.
 *    Procurar so nas primeiras linhas perdia a deteccao em silencio, entao a
 *    varredura e do documento inteiro. O risco de falso positivo (um
 *    estabelecimento chamado "Santander" numa fatura Nubank) e contido pela
 *    regra 3: dois bancos no documento anulam a deteccao em vez de escolher
 *    errado.
 *
 * 2. **`mercadopago` casa as duas grafias.** A sonda registrou "Mercado Pago" no
 *    corpo e o arquivo se chama `Fatura_MP_...`; o rotulo da tela usa
 *    `mercadopago`. As duas formas apontam para o mesmo parser.
 *
 * 3. **Sinais que se contradizem devolvem `null`.** Dois bancos no documento e
 *    evidencia anulada, e escolher errado entregaria a fatura ao parser errado —
 *    pior que nao decidir. `null` faz a UI pedir a escolha em vez de chutar.
 *
 * Modulo puro (CONVENTIONS §5): sem I/O, sem `Date`, sem `process.env`.
 */

import type { PdfTextRow } from './rows';

/** Emissores que a v1 sabe parsear. */
export type PdfIssuer = 'nubank' | 'santander' | 'mercadopago';

/**
 * Marcadores por emissor. Cada token e comparado em minusculas, por
 * `includes` — sao nomes proprios longos, sem risco de casar dentro de outra
 * palavra comum.
 */
const ISSUER_MARKERS: readonly { issuer: PdfIssuer; tokens: readonly string[] }[] =
  [
    { issuer: 'nubank', tokens: ['nubank'] },
    { issuer: 'santander', tokens: ['santander'] },
    { issuer: 'mercadopago', tokens: ['mercado pago', 'mercadopago'] },
  ];

/**
 * Identifica o banco emissor pelo texto do documento.
 *
 * Devolve `null` quando nenhum banco aparece ou quando mais de um aparece —
 * ver as decisoes no topo do arquivo.
 */
export function detectPdfIssuer(rows: PdfTextRow[]): PdfIssuer | null {
  const found = new Set<PdfIssuer>();

  for (const row of rows) {
    const text = row.text.toLowerCase();
    if (text === '') continue;
    for (const marker of ISSUER_MARKERS) {
      if (marker.tokens.some((token) => text.includes(token))) {
        found.add(marker.issuer);
      }
    }
  }

  if (found.size !== 1) return null;
  return [...found][0] ?? null;
}
