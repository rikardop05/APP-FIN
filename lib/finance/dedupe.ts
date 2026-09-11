/**
 * Deduplicacao de lancamentos — CONTRACTS §7.
 *
 * Modulo puro (CONVENTIONS §5). Usa `node:crypto` para o sha256: e uma funcao
 * de hash, nao I/O — nao le relogio, nao toca disco, nao alcanca rede, e a
 * mesma entrada sempre da a mesma saida.
 */

import { createHash } from 'node:crypto';

import { toCompetence, type IsoDate } from '@/lib/date';
import { cents, type Cents } from '@/lib/money';

/** Parcela reconhecida no fim de uma descricao: "3/10" -> numero 3, de 10. */
interface InstallmentMarker {
  number: number;
  count: number;
}

/** Maior numero de parcelas que um cartao pratica. Acima disso e outro numero. */
const MAX_INSTALLMENT_COUNT = 99;

/**
 * Formas de sufixo de parcela, da mais explicita para a mais ambigua. A ordem
 * importa: `parc 03/10` tem de casar como parcela marcada antes de cair na
 * forma nua `03/10`.
 */
const INSTALLMENT_PATTERNS: readonly RegExp[] = [
  // "(3/10)", "(3 de 10)"
  /\s*[-–—]?\s*\(\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\s*\)\s*$/,
  // "parc 03/10", "parcela 3 de 10", "parc. 3/10"
  /\s*[-–—]?\s*parc(?:ela)?\.?\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\s*$/,
  // "3 de 10"
  /\s*[-–—]?\s*(\d{1,2})\s*de\s*(\d{1,2})\s*$/,
  // Forma nua "03/10". Ver a nota sobre ambiguidade com data em
  // `splitInstallmentSuffix`.
  /\s*[-–—]?\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*$/,
];

/** Tira acento, caixa e espaco repetido. NAO mexe em sufixo de parcela. */
function normalizeText(raw: string): string {
  return raw
    .normalize('NFD')
    // Remove os diacriticos que o NFD separou: "ç" -> "c", "ã" -> "a".
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Separa a descricao do sufixo de parcela.
 *
 * LIMITE CONHECIDO, deliberado: a forma nua `03/10` no fim da descricao e
 * indistinguivel de uma data (3 de outubro) olhando so para a descricao. Aqui
 * ela e tratada como parcela, porque em descricao de fatura e o que ela quase
 * sempre e — e porque o custo dos dois erros e assimetrico: tratar parcela como
 * texto faz o dedupe falhar, enquanto o `dedupeHash` guarda o marcador de
 * volta, entao um falso positivo aqui nao funde dois lancamentos diferentes.
 * A desambiguacao de verdade e do detector de T-121 (`lib/import`), que ve a
 * linha inteira e tem a coluna de data ao lado.
 */
function splitInstallmentSuffix(normalized: string): {
  base: string;
  marker: InstallmentMarker | null;
} {
  for (const pattern of INSTALLMENT_PATTERNS) {
    const match = pattern.exec(normalized);
    if (match === null) continue;

    const number = Number(match[1]);
    const count = Number(match[2]);
    // "1/2" e parcela; "0/5" e "7/3" nao sao. Fora dessa faixa, o par de
    // numeros e outra coisa e a descricao fica inteira.
    if (number < 1 || count < 2 || number > count || count > MAX_INSTALLMENT_COUNT) {
      continue;
    }

    const base = normalized.slice(0, match.index).trim();
    // Sufixo sozinho, sem descricao antes, nao e sufixo de nada.
    if (base === '') continue;

    return { base, marker: { number, count } };
  }

  return { base: normalized, marker: null };
}

/**
 * Forma canonica de uma descricao: minuscula, sem acento, espacos colapsados e
 * sem o sufixo de parcela.
 *
 * "Mercado Livre  PARC 03/10" e "MERCADO LIVRE (3/10)" viram os dois
 * "mercado livre" — e o que permite agrupar as 10 parcelas de uma compra.
 */
export function normalizeDescription(raw: string): string {
  return splitInstallmentSuffix(normalizeText(raw)).base;
}

/**
 * Impressao digital de um lancamento, para achar a mesma transacao importada
 * duas vezes.
 *
 * O hash e insensivel a acento, caixa e espaco repetido, porque o mesmo banco
 * emite a mesma compra escrita de formas diferentes entre PDF e texto colado.
 * Mas e sensivel ao NUMERO DA PARCELA: 3/10 e 4/10 sao lancamentos distintos e
 * precisam de hashes distintos, entao o marcador volta ao final em forma
 * canonica (`#3/10`) em vez de ser descartado como em `normalizeDescription`.
 *
 * Duas compras realmente identicas no mesmo dia, no mesmo cartao e pelo mesmo
 * valor colidem. E o comportamento esperado: nao existe informacao no
 * lancamento que as separe, e quem decide se sao duas compras ou uma
 * importacao repetida e a tela de confirmacao.
 *
 * Os campos entram separados por NUL, que nao ocorre em texto de fatura: sem
 * separador, `sourceId` "ab" + data "c..." e "abc" + "..." dariam o mesmo hash.
 */
export function dedupeHash(input: {
  sourceId: string;
  occurredOn: IsoDate;
  amountCents: Cents;
  rawDescription: string;
}): string {
  // Valida que a data existe no calendario: '2026-02-30' e '2026-2-3' nao
  // podem virar hash, senao a mesma compra entra duas vezes com data escrita
  // de dois jeitos.
  toCompetence(input.occurredOn);
  const amount = cents(input.amountCents);

  const { base, marker } = splitInstallmentSuffix(normalizeText(input.rawDescription));
  const description =
    marker === null
      ? base
      : `${base} #${String(marker.number)}/${String(marker.count)}`;

  const canonical = [
    input.sourceId,
    input.occurredOn,
    String(amount),
    description,
  ].join('\u0000');

  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
