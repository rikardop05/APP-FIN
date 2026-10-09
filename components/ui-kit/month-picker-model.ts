/**
 * Lógica pura do seletor de mês (`MonthPicker`): valor `AAAA-MM`, nomes em pt-BR, sem depender do
 * idioma do navegador (o `<input type="month">` nativo escreve "October 2026" num sistema em inglês).
 */

export const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

export type MonthParts = { year: number; month: number };

/** `'2026-10'` -> `{ year: 2026, month: 10 }`; qualquer outra coisa (inclusive vazio) -> `null`. */
export function parseMonthValue(value: string): MonthParts | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (match === null) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** `{ 2026, 3 }` -> `'2026-03'`. */
export function buildMonthValue(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/**
 * Anos oferecidos: `span` anos para cada lado do centro, e sempre o ano do valor atual (mesmo fora da
 * janela), do mais recente ao mais antigo.
 */
export function yearOptions(center: number, span: number, current: number | null): number[] {
  const years = new Set<number>();
  for (let year = center - span; year <= center + span; year += 1) years.add(year);
  if (current !== null) years.add(current);
  return [...years].sort((a, b) => b - a);
}
