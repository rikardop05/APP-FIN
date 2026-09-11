/**
 * Formatação de exibição em pt-BR para números que NÃO são dinheiro nem data.
 *
 * Dinheiro passa por `formatBRL` (lib/money), data por `formatDateBR`
 * (lib/date) — este módulo não reimplementa nenhum dos dois. O único caso que
 * sobra e não tem dono é contagem simples (total de linhas, página atual),
 * consumido pela paginação de `DataTable`.
 *
 * `groupThousands` abaixo é idêntico ao homônimo de `lib/money`, que o mantém
 * privado — não há como reusar sem que `lib/money` (fora da posse do T-005) o
 * exporte. Se um dia exportar, este módulo passa a chamar de lá.
 */

/** Separador de milhar do pt-BR. */
const GROUP_SEPARATOR = '.';

/** Insere o separador de milhar a cada 3 dígitos, da direita para a esquerda. */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
}

/**
 * Formata um inteiro não-monetário com separador de milhar pt-BR:
 * `formatInteger(12345)` -> `'12.345'`, `formatInteger(-3)` -> `'-3'`.
 */
export function formatInteger(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `formatInteger espera um inteiro seguro; recebido: ${String(value)}.`,
    );
  }
  const negative = value < 0;
  const digits = groupThousands(String(Math.abs(value)));
  return negative ? `-${digits}` : digits;
}
