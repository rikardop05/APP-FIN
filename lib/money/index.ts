/**
 * Primitivos de dinheiro — CONTRACTS §1.
 *
 * Regras que este modulo existe para tornar impossiveis de violar
 * (CONVENTIONS §2 e §3):
 *
 * - Todo valor monetario e inteiro de centavos. `number` com decimal para
 *   dinheiro e proibido, e nenhuma funcao daqui produz um.
 * - Percentual e basis points inteiros: 500 bp = 5,00 %.
 * - Conversao para/de string acontece so na borda: `formatBRL` na exibicao,
 *   `parseBRL` na entrada.
 * - Saida de dinheiro e negativa, entrada e positiva. Este modulo nao aplica
 *   direcao: preserva o sinal que recebe.
 *
 * Zero dependencia externa e zero I/O. Em particular `formatBRL` NAO usa
 * `Intl.NumberFormat`: para chamar Intl seria preciso dividir os centavos por
 * 100 e passar um float, reintroduzindo em dinheiro exatamente o tipo que
 * CONVENTIONS §2 proibe. A formatacao aqui e feita sobre o inteiro, digito a
 * digito, e por isso e exata ate `Number.MAX_SAFE_INTEGER` (R$ 90 trilhoes).
 */

/** Inteiro de centavos. Safe integer cobre R$ 90.071.992.547.409,91. */
export type Cents = number & { readonly __brand: 'Cents' };

/** Percentual em basis points inteiros. 500 bp = 5,00 %. */
export type BasisPoints = number & { readonly __brand: 'BasisPoints' };

/** Centavos em uma unidade de real. */
const CENTS_PER_UNIT = 100;

/** Basis points em 100 %. */
const BP_SCALE = 10_000;

/** Separador de milhar do pt-BR. */
const GROUP_SEPARATOR = '.';

/** Separador decimal do pt-BR. */
const DECIMAL_SEPARATOR = ',';

/**
 * Constroi um `Cents` validando que e inteiro seguro.
 *
 * Lanca em vez de devolver `null` porque valor monetario invalido chegando ao
 * motor de calculo e bug de programacao, nao entrada de usuario — a entrada de
 * usuario passa por `parseBRL`, que devolve `null`.
 */
export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `Valor monetario deve ser inteiro de centavos dentro do safe integer; recebido: ${String(value)}.`,
    );
  }
  // `as`: o brand e nominal e so pode ser aplicado aqui, depois da validacao
  // que e a unica razao de ele existir. `value === 0 ? 0 : value` normaliza -0,
  // que sobrevive a Number.isSafeInteger e vazaria para formatBRL como "-".
  return (value === 0 ? 0 : value) as Cents;
}

/**
 * Constroi um `BasisPoints` validando que e inteiro seguro.
 *
 * Adicao a CONTRACTS §1: o contrato declara o tipo `BasisPoints` mas nenhum
 * construtor, e tipo com brand nao pode ser produzido sem um. Sem esta funcao
 * todo consumidor escreveria `500 as BasisPoints`, e CONVENTIONS §6 exige
 * comentario justificando cada `as`. E aditiva: nao altera nenhuma assinatura
 * declarada no contrato.
 */
export function basisPoints(value: number): BasisPoints {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `Basis points devem ser inteiros dentro do safe integer; recebido: ${String(value)}.`,
    );
  }
  // `as`: mesmo motivo de `cents` — unico ponto de entrada do brand.
  return (value === 0 ? 0 : value) as BasisPoints;
}

/** Insere o separador de milhar a cada 3 digitos, da direita para a esquerda. */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
}

/**
 * Formata para exibicao em pt-BR: `formatBRL(cents(-123456))` -> `'-R$ 1.234,56'`.
 *
 * `sign`:
 * - `'auto'` (padrao): mostra o `-` do valor negativo, nada no positivo.
 * - `'never'`: valor absoluto, sem sinal — para coluna que ja diz "saida".
 * - `'always'`: prefixa `+` no positivo — para variacao e saldo comparado.
 *
 * Zero nunca recebe sinal, em nenhum dos modos: `'+R$ 0,00'` nao e leitura util
 * de "nao variou".
 */
export function formatBRL(
  v: Cents,
  opts?: { sign?: 'auto' | 'never' | 'always' },
): string {
  const value = cents(v);
  const mode = opts?.sign ?? 'auto';

  const absolute = Math.abs(value);
  // Aritmetica inteira de proposito: `absolute / 100` seria float.
  const fraction = absolute % CENTS_PER_UNIT;
  const units = (absolute - fraction) / CENTS_PER_UNIT;

  const body = `R$ ${groupThousands(String(units))}${DECIMAL_SEPARATOR}${String(fraction).padStart(2, '0')}`;

  if (value === 0 || mode === 'never') return body;
  if (value < 0) return `-${body}`;
  return mode === 'always' ? `+${body}` : body;
}

/**
 * Le um valor digitado ou vindo de arquivo. Devolve `null` para qualquer coisa
 * que nao seja um valor monetario inequivoco — nunca lanca, nunca chuta.
 *
 * Aceita: `'1.234,56'` (pt-BR), `'1234.56'` (decimal com ponto), `'-R$ 10,00'`,
 * `'R$ 0,00'`, `'1.234.567,89'`, `'1,234,567.89'` (agrupamento en), `'10'`,
 * `',50'`. O sinal pode vir antes ou depois do `R$`, nunca nos dois lugares.
 *
 * NAO aceita, de proposito: `'(10,00)'` e `'10,00-'`. As duas sao convencoes de
 * layout de extrato para "credito"/"debito", e o que elas significam depende da
 * coluna em que aparecem — quem sabe isso e o parser de importacao, nao este
 * primitivo. Chutar a direcao aqui inverteria o sinal do lancamento em silencio.
 *
 * Devolve `null` para 3 ou mais casas decimais (`'1,234'`): centavo e a menor
 * unidade do sistema, e arredondar aqui esconderia erro de origem. O unico
 * arredondamento permitido e o de `allocate` (CONVENTIONS §2).
 *
 * O sinal e lido literalmente. A convencao "saida e negativa" e aplicada pelos
 * parsers de importacao, que sabem se a linha e debito ou credito.
 */
export function parseBRL(input: string): Cents | null {
  if (typeof input !== 'string') return null;

  // O \s do JS ja cobre NBSP (U+00A0) e narrow NBSP (U+202F), que e o que Intl
  // e extrato de banco colocam entre o simbolo e o numero.
  // U+2212 e o sinal de menos tipografico: PDF de fatura emite esse, nao o
  // hifen ASCII. E o mesmo caractere semanticamente, entao normaliza — recusar
  // faria o parser de PDF descartar toda linha negativa em silencio.
  const compact = input.replace(/\s/g, '').replace(/\u2212/g, '-');
  if (compact === '') return null;

  const shape = /^([+-]?)(R\$)?([+-]?)([\d.,]+)$/i.exec(compact);
  if (shape === null) return null;

  const signBefore = shape[1] ?? '';
  const signAfter = shape[3] ?? '';
  const body = shape[4] ?? '';

  // "-R$ -10,00" nao e um valor, e um erro de montagem da string.
  if (signBefore !== '' && signAfter !== '') return null;
  const negative = `${signBefore}${signAfter}` === '-';

  if (!/\d/.test(body)) return null;

  const dots = body.split('.').length - 1;
  const commas = body.split(',').length - 1;

  // Qual dos dois caracteres e o separador decimal desta string.
  let decimalSeparator: '.' | ',' | null;

  if (dots > 0 && commas > 0) {
    // Os dois presentes: o que aparece por ultimo e o decimal, o outro agrupa.
    decimalSeparator = body.lastIndexOf('.') > body.lastIndexOf(',') ? '.' : ',';
    // Um numero tem no maximo um separador decimal.
    if ((decimalSeparator === '.' ? dots : commas) > 1) return null;
    // Separador de milhar depois do decimal e lixo: "1,234.567.890".
    const groupSeparator = decimalSeparator === '.' ? ',' : '.';
    if (body.lastIndexOf(groupSeparator) > body.indexOf(decimalSeparator)) {
      return null;
    }
  } else if (commas > 0) {
    // So virgulas: uma e decimal pt-BR ("10,50"); varias so podem ser
    // agrupamento en ("1,234,567").
    decimalSeparator = commas === 1 ? ',' : null;
  } else if (dots === 1) {
    // Um ponto e o caso ambiguo: "1.234" (milhar pt-BR) ou "1234.56" (decimal).
    // Vale milhar so quando a string tem a forma exata de um grupo: parte
    // inteira de 1 a 3 digitos sem zero a esquerda, seguida de exatamente 3
    // digitos. "0.567" nao passa, e cai como decimal de 3 casas -> null.
    const cut = body.indexOf('.');
    const head = body.slice(0, cut);
    const tail = body.slice(cut + 1);
    decimalSeparator = tail.length === 3 && /^[1-9]\d{0,2}$/.test(head) ? null : '.';
  } else {
    // Nenhum ponto, ou varios (todos agrupamento pt-BR): sem parte decimal.
    decimalSeparator = null;
  }

  let integerRaw: string;
  let fractionRaw: string;
  if (decimalSeparator === null) {
    integerRaw = body;
    fractionRaw = '';
  } else {
    const cut = body.lastIndexOf(decimalSeparator);
    integerRaw = body.slice(0, cut);
    fractionRaw = body.slice(cut + 1);
  }

  if (!/^\d{0,2}$/.test(fractionRaw)) return null;

  // O separador de milhar e o caractere que sobrou. Quando nao ha decimal
  // nenhum, o que sobrou e o que de fato aparece na string: sem esta escolha,
  // `'1,234,567'` (agrupamento en sem centavos) cairia em null enquanto
  // `'1.234.567'` passa.
  let groupSeparator: '.' | ',';
  if (decimalSeparator === '.') {
    groupSeparator = ',';
  } else if (decimalSeparator === ',') {
    groupSeparator = '.';
  } else {
    groupSeparator = commas > 0 ? ',' : '.';
  }

  let integerDigits: string;
  if (integerRaw.includes(groupSeparator)) {
    // Com separador de milhar, a forma tem de fechar exatamente.
    const grouped =
      groupSeparator === '.'
        ? /^[1-9]\d{0,2}(?:\.\d{3})+$/
        : /^[1-9]\d{0,2}(?:,\d{3})+$/;
    if (!grouped.test(integerRaw)) return null;
    integerDigits = integerRaw.split(groupSeparator).join('');
  } else {
    if (!/^\d*$/.test(integerRaw)) return null;
    integerDigits = integerRaw;
  }

  const digits = `${integerDigits}${fractionRaw.padEnd(2, '0')}`.replace(
    /^0+(?=\d)/,
    '',
  );
  const magnitude = Number(digits);
  // Round-trip pela string: pega perda de precisao antes de virar dinheiro
  // errado. `Number('9007199254740993')` nao e igual a string de volta.
  if (!Number.isSafeInteger(magnitude) || String(magnitude) !== digits) {
    return null;
  }

  return cents(negative ? -magnitude : magnitude);
}

/**
 * Soma exata. Sem argumentos devolve zero — util para reduce de lista vazia.
 *
 * O acumulador e `bigint` porque somar em `number` perde centavo em silencio
 * quando um total PARCIAL passa de 2^53 e volta: `MAX_SAFE_INTEGER + 1 + 1 - 2`
 * da MAX_SAFE_INTEGER - 1, e o resultado errado ainda e um inteiro seguro,
 * entao a validacao final o aceitaria. Somando em bigint o parcial nunca
 * arredonda, e so o total real e checado contra o limite de `Cents`.
 */
export function addCents(...values: Cents[]): Cents {
  let total = 0n;
  for (const value of values) {
    total += BigInt(cents(value));
  }
  return cents(Number(total));
}

/**
 * Aplica um percentual em basis points, arredondando para o centavo mais
 * proximo. `applyRate(cents(10000), basisPoints(500))` = R$ 100,00 x 5 % = 500.
 *
 * O produto `v * bp` estoura o safe integer bem antes do limite de `Cents`
 * (R$ 90 tri a 100 % ja passa), entao a multiplicacao acontece em `bigint` e so
 * o resultado ja dividido volta para `number`. Empate (meio centavo exato) se
 * afasta do zero, nos dois sinais: 0,5 -> 1 e -0,5 -> -1.
 */
export function applyRate(v: Cents, bp: BasisPoints): Cents {
  const value = BigInt(cents(v));
  const rate = BigInt(basisPoints(bp));
  const scale = BigInt(BP_SCALE);

  const product = value * rate;
  const negative = product < 0n;
  const magnitude = negative ? -product : product;
  const rounded = (magnitude + scale / 2n) / scale;

  return cents(Number(negative ? -rounded : rounded));
}

/**
 * Divide um valor em N partes cuja soma fecha EXATAMENTE com o total.
 *
 * O resto vai para as primeiras partes (CONVENTIONS §2): R$ 100,00 em 3x da
 * 33,34 / 33,33 / 33,33. Em valor negativo o resto tambem e negativo, entao a
 * primeira parcela continua sendo a maior em modulo e a soma continua exata.
 */
export function allocate(total: Cents, parts: number): Cents[] {
  const value = cents(total);
  if (!Number.isSafeInteger(parts) || parts < 1) {
    throw new RangeError(
      `Numero de partes deve ser inteiro >= 1; recebido: ${String(parts)}.`,
    );
  }

  // `%` e `-` sao exatos em inteiros seguros, e `value - remainder` e divisivel
  // por `parts`, entao a divisao tambem e exata: nada de float.
  const remainder = value % parts;
  const base = (value - remainder) / parts;
  const extra = remainder < 0 ? -1 : 1;
  const partsWithExtra = Math.abs(remainder);

  const result: Cents[] = [];
  for (let index = 0; index < parts; index += 1) {
    result.push(cents(index < partsWithExtra ? base + extra : base));
  }
  return result;
}

/** Basis points para o decimal usado dentro do calculo: 500 bp -> 0.05. */
export function bpToDecimal(bp: BasisPoints): number {
  return basisPoints(bp) / BP_SCALE;
}
