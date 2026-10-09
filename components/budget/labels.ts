import { cents, formatBRL, type BasisPoints, type Cents } from '@/lib/money';

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

/**
 * `2026-10` -> `Outubro de 2026`: o mesmo texto de `competenceLabel` com SÓ a primeira letra em
 * maiúscula. Antes o título usava a classe CSS `capitalize`, que capitaliza toda palavra e dava
 * "Outubro De 2026" (o "de" em maiúscula não é português).
 */
export function competenceTitle(competence: string): string {
  const label = competenceLabel(competence);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Valor para o CAMPO do formulário: `120050` -> `1.200,50` (sem `R$`). */
export function toFieldText(value: Cents): string {
  return formatBRL(value).replace(/^R\$\s*/, '').trim();
}

export type LightView = {
  /** Texto: a cor sozinha não basta (acessibilidade e impressão em preto e branco). Existe em `ESTADO_LETRA`. */
  label: string;
  badge: 'success' | 'warning' | 'danger';
  /** Tom do Selo de estado da linha. */
  tone: 'ok' | 'attention' | 'danger';
  bar: string;
};

/** Apresentação do semáforo. QUEM decide a cor é o motor; aqui só se escolhe o texto. */
export const LIGHT_VIEW: Record<'green' | 'yellow' | 'red', LightView> = {
  green: { label: 'Dentro do limite', badge: 'success', tone: 'ok', bar: 'bg-success' },
  yellow: { label: 'Perto do limite', badge: 'warning', tone: 'attention', bar: 'bg-warning' },
  red: { label: 'Estourou', badge: 'danger', tone: 'danger', bar: 'bg-destructive' },
};

/**
 * O que a cor mede (decisão 10b do Ricardo, 2026-10-07): o TOTAL ESPERADO do mês, realizado
 * + previsto a realizar. O rótulo diz as duas parcelas, para ninguém ler a cor como "já gastei".
 */
export const EXPECTED_LABEL = 'Realizado + previsto';

/**
 * Percentual inteiro, sem casas: `9500` -> `95%`, `9549` -> `95%`, `9550` -> `96%`. A barra e a cor já
 * dizem a medida fina; "95,00%" fingia uma precisão que ninguém usa para decidir.
 */
export function formatPercent(bp: BasisPoints): string {
  return `${String(Math.round(Number(bp) / 100))}%`;
}

/** `'Realizado + previsto: 95% do orçamento'`; sem valor orçado quando `usageBp` é null. */
export function expectedUsageText(usageBp: BasisPoints | null): string {
  return usageBp === null
    ? `${EXPECTED_LABEL}: sem valor orçado`
    : `${EXPECTED_LABEL}: ${formatPercent(usageBp)} do orçamento`;
}

/** Folga do mês já contando o previsto (`remainingCents` do motor), ou quanto vai passar. */
export function remainingText(remainingCents: Cents): string {
  return remainingCents < 0
    ? `Passa ${formatBRL(cents(-remainingCents), { sign: 'never' })} do orçamento contando o previsto`
    : `Restam ${formatBRL(remainingCents, { sign: 'never' })} contando o previsto`;
}

/**
 * Selo (com letra) da linha do Orçamento: SÓ para o que pede atenção, perto do limite e estourou.
 * Dentro do limite é o estado normal e não leva selo (contrato: selo e letra só em linha que precisa de
 * atenção). `null` = sem selo.
 */
export function rowMarca(light: 'green' | 'yellow' | 'red'): { label: string; tone: LightView['tone'] } | null {
  if (light === 'green') return null;
  const view = LIGHT_VIEW[light];
  return { label: view.label, tone: view.tone };
}
