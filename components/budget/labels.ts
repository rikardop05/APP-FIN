import { formatBRL, type Cents } from '@/lib/money';

const MONTHS = [
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
];

/** `2026-10` -> `outubro de 2026`. */
export function competenceLabel(competence: string): string {
  const year = competence.slice(0, 4);
  const month = Number(competence.slice(5, 7));
  return `${MONTHS[month - 1] ?? competence} de ${year}`;
}

/** Valor para o CAMPO do formulário: `120050` -> `1.200,50` (sem `R$`). */
export function toFieldText(value: Cents): string {
  return formatBRL(value).replace(/^R\$\s*/, '').trim();
}

export type LightView = {
  /** Texto: a cor sozinha não basta (acessibilidade e impressão em preto e branco). */
  label: string;
  badge: 'success' | 'warning' | 'danger';
  bar: string;
};

/** Apresentação do semáforo. QUEM decide a cor é o motor; aqui só se escolhe o texto. */
export const LIGHT_VIEW: Record<'green' | 'yellow' | 'red', LightView> = {
  green: { label: 'Dentro do limite', badge: 'success', bar: 'bg-emerald-500' },
  yellow: { label: 'Perto do limite', badge: 'warning', bar: 'bg-amber-500' },
  red: { label: 'Estourou', badge: 'danger', bar: 'bg-red-500' },
};
