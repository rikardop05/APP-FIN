import type { Competence } from '@/lib/date';

const SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;
const LONG = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
] as const;

function parts(competence: Competence): { year: string; index: number } {
  const year = competence.slice(0, 4);
  const index = Number(competence.slice(5, 7)) - 1;
  if (!/^\d{4}-\d{2}$/.test(competence) || index < 0 || index > 11) {
    throw new RangeError(`Competência inválida: ${competence}.`);
  }
  return { year, index };
}

/** `2027-03` → `mar/2027`. */
export function competenceShort(competence: Competence): string {
  const { year, index } = parts(competence);
  return `${SHORT[index]}/${year}`;
}

/** `2027-03` → `mar`: só o mês abreviado, para eixo estreito de gráfico (o ano vem do contexto). */
export function competenceMonth(competence: Competence): string {
  const { index } = parts(competence);
  return SHORT[index] ?? competence;
}

/** `2027-03` → `março de 2027`. */
export function competenceLong(competence: Competence): string {
  const { year, index } = parts(competence);
  return `${LONG[index]} de ${year}`;
}
