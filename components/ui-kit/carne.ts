import type { Cents } from '@/lib/money';

/**
 * Lógica pura do vocabulário do Carnê de Prestações (ui-kit). Fora dos .tsx porque o vitest não
 * transforma JSX: os componentes (`Canhoto`, `Placar`, `Selo`) só escolhem o que desenhar.
 */

/** `3, 10` -> `03/10`: numeração de canhoto, sempre com dois dígitos (ou a largura do total, se maior). */
export function parcelaLabel(atual: number, total: number): string {
  if (!Number.isInteger(atual) || !Number.isInteger(total) || atual < 1 || atual > total) {
    throw new RangeError(`Parcela inválida: ${String(atual)}/${String(total)}.`);
  }
  const width = Math.max(2, String(total).length);
  return `${String(atual).padStart(width, '0')}/${String(total).padStart(width, '0')}`;
}

export type PlacarTone = 'ok' | 'danger' | 'neutral';

/**
 * Tom da DIFERENÇA do placar (total da fatura × incluído): zera = confere (verde); qualquer
 * centavo = diverge (carimbo vermelho); sem total impresso para conferir = neutro.
 */
export function placarTone(differenceCents: Cents | null): PlacarTone {
  if (differenceCents === null) return 'neutral';
  return differenceCents === 0 ? 'ok' : 'danger';
}

/** A letra do selo: uma só, maiúscula. O estado nunca depende só da cor (acessibilidade). */
export function seloLetter(text: string): string {
  const first = text.trim().charAt(0);
  if (first === '') throw new RangeError('O selo de estado precisa de uma letra.');
  return first.toUpperCase();
}

export type SeloTone = 'neutral' | 'ok' | 'attention' | 'danger';

/**
 * Classes por tom: `box` é o quadradinho da letra (cheio), `frame` o contorno e o texto. Só `danger`
 * usa o vermelho de carimbo; atenção usa o âmbar e confere usa o verde.
 */
export const SELO_TONE_CLASS: Record<SeloTone, { box: string; frame: string }> = {
  neutral: {
    box: 'bg-foreground text-background',
    frame: 'border-foreground/40 bg-card text-foreground',
  },
  ok: {
    box: 'bg-success text-success-foreground',
    frame: 'border-success bg-success-soft text-success',
  },
  attention: {
    box: 'bg-warning text-warning-foreground',
    frame: 'border-warning bg-warning-soft text-warning',
  },
  danger: {
    box: 'bg-destructive text-destructive-foreground',
    frame: 'border-destructive bg-destructive-soft text-destructive',
  },
};

const MES_TALAO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;

/**
 * Data do TALÃO do canhoto: `'2026-10-04'` -> `'04 out'`. O talão significa UMA coisa por linha: parcela
 * n/N (`Parcela`, `03/10`, com barra) OU data (`04 out`, com mês por extenso abreviado e sem barra). Assim
 * `04/10` nunca é ambíguo entre dia/mês e parcela. Ano fora do talão (a linha ou o cabeçalho o dizem).
 */
export function dataTalao(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12) throw new RangeError(`Data inválida para o talão: ${iso}.`);
  return `${match[3]} ${MES_TALAO[month - 1]}`;
}

/**
 * Letra do selo por ESTADO, única no app todo (tabela espelhada no DESIGN.md). A letra aparece sozinha no
 * quadradinho: duas letras iguais para estados diferentes (N de "Não categorizado" e "Não paga") fariam o
 * selo mentir. O `Selo` consulta esta tabela pelo rótulo; só cai na inicial do rótulo se o estado for novo
 * (e o teste `carne.test.ts` exige que a tabela não repita letra).
 */
export const ESTADO_LETRA: Record<string, string> = {
  Incompleta: 'I',
  'Baixa confiança': 'B',
  Duplicada: 'D',
  Pagamento: 'G',
  Informativa: 'F',
  Previsto: 'P',
  'Não categorizado': 'C',
  'Não paga': 'N',
  'Vencida, não marcada como paga': 'V',
  Divergência: 'E',
  'Vencimento desatualizado': 'U',
  'Saldo negativo': 'A',
  'Sem saldo negativo': 'S',
  Confirmado: 'O',
  Desfeito: 'H',
  Pendente: 'T',
  Falhou: 'K',
  Aberta: 'R',
  Fechada: 'M',
  Paga: 'Z',
};

/** Letra do estado: a da tabela central, ou (estado novo, ainda sem entrada) a inicial do rótulo. */
export function letraDoEstado(label: string): string {
  return ESTADO_LETRA[label] ?? seloLetter(label);
}
